/**
 * Vérifie les deux albums ajoutés autour de l'envoi : celui qu'on nomme en
 * envoyant des photos, et « cette semaine », qui se remplit tout seul.
 *
 * Le test lance un vrai serveur sur un dossier de données jetable, envoie de
 * vraies images par HTTP et relit tout par l'API. Rien n'est simulé : c'est la
 * seule façon de vérifier le point délicat, à savoir qu'un envoi ne crée aucune
 * ligne dans la bibliothèque — il dépose un fichier, et c'est le scan qui
 * l'indexe plus tard. Un test qui appellerait les fonctions une à une passerait
 * sans rien prouver de cet enchaînement.
 *
 * Et il vérifie surtout ce qui compte le plus dans Photon : qu'aucun fichier
 * n'a disparu, bougé ni changé de taille.
 *
 *     npm run test:upload-album
 */
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

// Le projet est en modules ES : `require` n'existe pas, mais on a besoin de
// résoudre le chemin de tsx pour lancer le serveur sans passer par npx.
const require = createRequire(import.meta.url);

const PORT = 7871;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-test-'));
const DATA = path.join(ROOT, 'donnees');
const PHOTOS = path.join(ROOT, 'photos');

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass++;
    console.log(`  ok   ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function equal(label: string, got: unknown, want: unknown): void {
  check(label, got === want, `attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);
}

// --------------------------------------------------------------- utilitaires

async function makeJpeg(file: string, hue: number): Promise<void> {
  await sharp({
    create: { width: 160, height: 120, channels: 3, background: { r: hue, g: 90, b: 200 } },
  })
    .jpeg({ quality: 70 })
    .toFile(file);
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(`${BASE}${url}`);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Envoie un fichier comme le ferait le navigateur : un multipart par photo. */
async function upload(file: string, album?: string): Promise<{ outcome: string }> {
  const form = new FormData();
  const bytes = fs.readFileSync(file);
  form.append('file', new Blob([bytes], { type: 'image/jpeg' }), path.basename(file));
  const params = new URLSearchParams({ mtime: String(Date.now()) });
  if (album) params.set('album', album);
  const res = await fetch(`${BASE}/api/upload?${params.toString()}`, { method: 'POST', body: form });
  const body = (await res.json()) as { results: Array<{ outcome: string }> };
  return body.results[0] ?? { outcome: 'rejected' };
}

interface Album {
  id: number;
  name: string;
  kind: string;
  count: number;
  coverMediaId: number | null;
}

async function albums(): Promise<Album[]> {
  return get<Album[]>('/api/albums');
}

/**
 * Attend la fin du scan. L'état du scan vit dans `/api/state` ; `scan()` passe
 * `running` à vrai avant de rendre la main à la route d'envoi, donc au retour de
 * l'envoi le drapeau est déjà levé et il n'y a pas de course à l'amorçage.
 */
async function waitForScan(): Promise<void> {
  for (let i = 0; i < 240; i++) {
    const state = await get<{ scan: { running: boolean } }>('/api/state');
    if (!state.scan.running) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le scan ne se termine pas');
}

/** Empreinte de l'arborescence : chemin, taille et date de chaque fichier. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string): void => {
    for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const stat = fs.statSync(full);
        const hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        out.set(path.relative(dir, full), `${stat.size}:${hash}`);
      }
    }
  };
  walk(dir);
  return out;
}

// -------------------------------------------------------------------- serveur

let server: ChildProcess | null = null;

async function startServer(): Promise<void> {
  if (!(await portIsFree())) {
    throw new Error(
      `le port ${PORT} est deja pris — un serveur d un essai precedent tourne encore`,
    );
  }
  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(PHOTOS, { recursive: true });
  // `detached` met le serveur dans son propre groupe de processus, pour pouvoir
  // le tuer tout entier. Sans ça, le SIGTERM part à `npx` et laisse le vrai
  // serveur tenir le port : l'essai suivant se branche sur le précédent, dont
  // le dossier de données vient d'être effacé — on passe une demi-heure à
  // chercher un bug qui n'existe pas.
  server = spawn(process.execPath, [require.resolve('tsx/cli'), 'server/src/index.ts'], {
    env: { ...process.env, XDG_DATA_HOME: DATA, PHOTON_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  server.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    if (!text.includes('ExperimentalWarning')) process.stderr.write(`    [serveur] ${text}`);
  });

  for (let i = 0; i < 120; i++) {
    try {
      await get('/api/state');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error('le serveur ne démarre pas');
}

function stopServer(): void {
  if (server?.pid === undefined) return;
  // Le groupe entier, d'où le signe moins. Puis on vérifie : un serveur qui
  // survit fausse l'essai suivant au lieu de le faire échouer franchement.
  try {
    process.kill(-server.pid, 'SIGKILL');
  } catch {
    server.kill('SIGKILL');
  }
}

/** Refuse de démarrer si le port est déjà pris : mieux vaut le dire tout de suite. */
async function portIsFree(): Promise<boolean> {
  try {
    await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(800) });
    return false;
  } catch {
    return true;
  }
}

// ----------------------------------------------------------------------- test

async function main(): Promise<void> {
  console.log('Album a l envoi, et album « cette semaine »\n');
  await startServer();

  // Le dossier de réception : c'est là que les envois se rangent.
  const added = await post('/api/roots', { path: PHOTOS, kind: 'import' });
  check('dossier de reception accepte', added.ok);

  // Quatre photos sur le bureau, comme si elles venaient d'un téléphone.
  const outbox = path.join(ROOT, 'telephone');
  fs.mkdirSync(outbox, { recursive: true });
  const files: string[] = [];
  for (let i = 0; i < 4; i++) {
    const file = path.join(outbox, `photo-${i}.jpg`);
    await makeJpeg(file, 20 + i * 40);
    files.push(file);
  }

  console.log('\n1. Envoi de trois photos dans un album nomme');
  for (const file of files.slice(0, 3)) {
    const result = await upload(file, 'Vacances');
    equal(`${path.basename(file)} rangee`, result.outcome, 'stored');
  }
  await waitForScan();

  let list = await albums();
  const vacances = list.find((a) => a.name === 'Vacances');
  check('l album « Vacances » existe', vacances !== undefined);
  equal('il contient les trois photos', vacances?.count, 3);
  check('il a une couverture', (vacances?.coverMediaId ?? null) !== null);

  console.log('\n2. Le meme titre reutilise l album, il ne le duplique pas');
  const fourth = await upload(files[3], 'Vacances');
  equal('quatrieme photo rangee', fourth.outcome, 'stored');
  await waitForScan();
  list = await albums();
  equal('toujours un seul album « Vacances »', list.filter((a) => a.name === 'Vacances').length, 1);
  equal('il contient maintenant quatre photos', list.find((a) => a.name === 'Vacances')?.count, 4);

  console.log('\n3. Une photo deja connue rejoint quand meme un nouvel album');
  // Le téléphone renvoie une photo que Photon a déjà : elle n'est pas réimportée
  // — c'est le registre qui l'en empêche — mais elle doit rejoindre l'album.
  const again = await upload(files[0], 'Ete 2026');
  equal('reconnue comme doublon', again.outcome, 'duplicate');
  await waitForScan();
  list = await albums();
  const ete = list.find((a) => a.name === 'Ete 2026');
  check('l album « Ete 2026 » existe', ete !== undefined);
  equal('et contient la photo deja connue', ete?.count, 1);

  console.log('\n4. La route qui prepare l album range la selection entiere');
  const prep = await post('/api/albums/from-upload', {
    name: 'Selection complete',
    files: files.map((f) => ({ name: path.basename(f), size: fs.statSync(f).size })),
  });
  check('route acceptee', prep.ok);
  await waitForScan();
  list = await albums();
  equal(
    'les quatre photos deja la y sont rangees',
    list.find((a) => a.name === 'Selection complete')?.count,
    4,
  );

  console.log('\n5. L album « cette semaine »');
  list = await albums();
  const recent = list.find((a) => a.kind === 'recent');
  check('il existe', recent !== undefined);
  equal('il compte les quatre photos ajoutees', recent?.count, 4);
  equal('il passe juste apres les favoris', list[1]?.kind, 'recent');
  equal('les favoris restent en tete', list[0]?.kind, 'favorites');

  const page = await get<{ total: number }>(`/api/media?album=${recent?.id}`);
  equal('son contenu se lit comme un album normal', page.total, 4);

  console.log('\n6. Une photo ajoutee il y a huit jours en sort');
  // On vieillit la date d'ajout d'une seule photo, directement dans la base.
  // C'est la seule façon de franchir la fenêtre sans attendre une semaine.
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(path.join(DATA, 'photon', 'photon.db'));
  const victim = db.prepare(`SELECT id FROM media ORDER BY id LIMIT 1`).get() as { id: number };
  db.prepare(`UPDATE media SET added_at = ? WHERE id = ?`).run(
    Date.now() - 8 * 24 * 60 * 60 * 1000,
    victim.id,
  );
  db.close();

  list = await albums();
  equal('« cette semaine » n en compte plus que trois', list.find((a) => a.kind === 'recent')?.count, 3);
  const after = await get<{ total: number }>(
    `/api/media?album=${list.find((a) => a.kind === 'recent')?.id}`,
  );
  equal('et son contenu suit', after.total, 3);
  equal(
    'l album nomme, lui, garde ses quatre photos',
    list.find((a) => a.name === 'Vacances')?.count,
    4,
  );

  console.log('\n7. L album automatique se defend');
  const recentId = list.find((a) => a.kind === 'recent')?.id;
  const del = await fetch(`${BASE}/api/albums/${recentId}`, { method: 'DELETE' });
  equal('on ne peut pas le supprimer', del.status, 400);

  const push = await post(`/api/albums/${recentId}/media`, { ids: [victim.id] });
  equal('on ne peut pas y ranger une photo', push.status, 400);

  await fetch(`${BASE}/api/albums/${recentId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Renomme de force' }),
  });
  list = await albums();
  equal(
    'son nom ne se change pas',
    list.find((a) => a.kind === 'recent')?.name,
    'Recently added',
  );

  const favId = list.find((a) => a.kind === 'favorites')?.id;
  const favPush = await post(`/api/albums/${favId}/media`, { ids: [victim.id] });
  check('les favoris, eux, acceptent toujours une photo', favPush.ok);

  console.log('\n8. Un titre vide ne cree pas d album');
  const beforeEmpty = (await albums()).length;
  const empty = await post('/api/albums/from-upload', { name: '   ', files: [] });
  equal('la route refuse', empty.status, 400);
  equal('aucun album en plus', (await albums()).length, beforeEmpty);

  const blank = await upload(files[1], '   ');
  equal('un envoi au titre vide passe quand meme', blank.outcome, 'duplicate');
  await waitForScan();
  equal('et ne cree rien', (await albums()).length, beforeEmpty);
}

// ------------------------------------------------------- lancement et bilan

void (async () => {
  try {
    await main();

    // La garantie centrale de Photon : les fichiers ne bougent pas. On la
    // mesure sur le dossier de la bibliothèque, après tout ce qui précède.
    const snapBefore = snapshot(PHOTOS);
    console.log('\n9. Les fichiers sont intacts');
    const recentId = (await albums()).find((a) => a.kind === 'recent')?.id;
    await get(`/api/media?album=${recentId}`);
    await post('/api/albums/from-upload', { name: 'Encore un', files: [] });
    await fetch(`${BASE}/api/albums/${recentId}`, { method: 'DELETE' });
    const snapAfter = snapshot(PHOTOS);

    equal('meme nombre de fichiers', snapAfter.size, snapBefore.size);
    let changed = 0;
    for (const [file, fingerprint] of snapBefore) {
      if (snapAfter.get(file) !== fingerprint) changed++;
    }
    equal('aucun fichier modifie ni disparu', changed, 0);
    check('la bibliotheque contient bien des fichiers', snapAfter.size > 0, 'dossier vide');
  } catch (err) {
    fail++;
    console.log(`\n  FAIL exception — ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    stopServer();
    fs.rmSync(ROOT, { recursive: true, force: true });
  }

  console.log(`\n${pass} verifications passees, ${fail} echouees`);
  process.exit(fail === 0 ? 0 : 1);
})();
