/**
 * Partage d'album : ce qu'un invité voit, et surtout tout ce qu'il ne voit pas.
 *
 * Ce test compte plus que les autres. Jusqu'ici Photon n'était joignable que
 * depuis le salon, et tout le code repose là-dessus — `isAdmin()` répond « oui »
 * par défaut pour cette raison. Le partage ouvre le serveur à l'extérieur : si
 * le garde par origine a un trou, ce n'est pas une fonction qui marche mal,
 * c'est la bibliothèque entière qui se promène.
 *
 * On simule donc un visiteur distant comme le fait un tunnel Cloudflare —
 * requête venue de 127.0.0.1, avec les en-têtes du proxy — et on essaie de
 * s'échapper par tous les chemins qu'on peut imaginer.
 *
 *     npm run test:share
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import DatabaseCtor from 'better-sqlite3';
import sharp from 'sharp';

const require = createRequire(import.meta.url);

const PORT = 7873;
const BASE = `http://127.0.0.1:${PORT}`;
const PUBLIC_HOST = 'photos.exemple.test';
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'photon-share-'));
const DATA = path.join(ROOT, 'donnees');
const PHOTOS = path.join(ROOT, 'photos');

let pass = 0;
let fail = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); }
};
const equal = (label: string, got: unknown, want: unknown): void =>
  check(label, got === want, `attendu ${JSON.stringify(want)}, obtenu ${JSON.stringify(got)}`);

/**
 * Une requête « de la maison » : directe, sans en-tête de proxy.
 */
function home(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${url}`, init);
}

/**
 * Une requête « de dehors », telle que `cloudflared` la présente au serveur :
 * elle arrive bien de 127.0.0.1 — le tunnel tourne sur le PC — mais porte les
 * en-têtes que Cloudflare ajoute et que le visiteur ne peut pas retirer.
 */
function away(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${url}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      host: PUBLIC_HOST,
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': '203.0.113.7',
      'cf-ray': 'deadbeefcafe-CDG',
    },
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

let server: ChildProcess | null = null;

async function startServer(): Promise<void> {
  try {
    await fetch(`${BASE}/api/state`, { signal: AbortSignal.timeout(800) });
    throw new Error(`le port ${PORT} est deja pris`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('deja pris')) throw err;
  }

  fs.mkdirSync(DATA, { recursive: true });
  fs.mkdirSync(PHOTOS, { recursive: true });
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
      if ((await home('/api/state')).ok) return;
    } catch { /* pas encore prêt */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le serveur ne démarre pas');
}

function stopServer(): void {
  if (server?.pid === undefined) return;
  try { process.kill(-server.pid, 'SIGKILL'); } catch { server.kill('SIGKILL'); }
}

async function waitForScan(): Promise<void> {
  for (let i = 0; i < 240; i++) {
    const state = await json<{ scan: { running: boolean } }>(await home('/api/state'));
    if (!state.scan.running) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('le scan ne se termine pas');
}

interface Album { id: number; name: string; kind: string; count: number }
interface Share { token: string; url: string | null; hasPassword: boolean }

async function main(): Promise<void> {
  console.log('Partage d album : ce qu un invite voit, et ce qu il ne voit pas\n');
  await startServer();

  // Six photos : trois iront dans l'album partagé, trois resteront privées.
  const month = path.join(PHOTOS, '2026', '10 - Oct');
  fs.mkdirSync(month, { recursive: true });
  for (let i = 0; i < 6; i++) {
    await sharp({
      create: { width: 180, height: 140, channels: 3, background: { r: 20 + i * 35, g: 90, b: 180 } },
    }).jpeg().toFile(path.join(month, `photo-${i}.jpg`));
  }

  await home('/api/roots', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: PHOTOS, kind: 'photos' }),
  });
  await home('/api/scan', { method: 'POST' });
  await waitForScan();

  const page = await json<{ items: Array<{ id: number }>; total: number }>(
    await home('/api/media?limit=50'),
  );
  equal('six photos indexees', page.total, 6);
  const shared = page.items.slice(0, 3).map((i) => i.id);
  const privateIds = page.items.slice(3).map((i) => i.id);

  // Un album qui contient les trois premières.
  const album = await json<Album>(
    await home('/api/albums', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Vacances a partager', color: 200, musicSlot: null, videoMusicPct: 20,
        background: null, backgroundOpacity: 35, tags: [],
      }),
    }),
  );
  await home(`/api/albums/${album.id}/media`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: shared }),
  });

  // Le nom public, sans lequel le lien ne vaut rien.
  await home('/api/share-config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicHostname: `https://${PUBLIC_HOST}/` }),
  });
  const config = await json<{ publicHostname: string }>(await home('/api/share-config'));
  equal('le nom public est nettoye de son https:// et de son /', config.publicHostname, PUBLIC_HOST);

  console.log('\n1. Creer un lien, depuis la maison');
  const share = await json<Share>(
    await home(`/api/albums/${album.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Pour tante Claire', days: 7, allowDownload: true }),
    }),
  );
  check('un jeton est rendu', /^[0-9a-f]{64}$/.test(share.token), share.token);
  equal('et l adresse complete a transmettre', share.url, `https://${PUBLIC_HOST}/p/${share.token}`);

  console.log('\n2. Le garde par origine');
  equal('de la maison, l accueil repond', (await home('/')).status, 200);
  equal('de dehors, l accueil est introuvable', (await away('/')).status, 404);
  equal('de dehors, /api/state est introuvable', (await away('/api/state')).status, 404);
  equal('de dehors, /api/media est introuvable', (await away('/api/media')).status, 404);
  equal('de dehors, /api/albums est introuvable', (await away('/api/albums')).status, 404);
  equal('de dehors, /api/roots est introuvable', (await away('/api/roots')).status, 404);
  equal(
    'de dehors, une photo par la route normale est introuvable',
    (await away(`/api/file/${shared[0]}`)).status,
    404,
  );
  equal(
    'de dehors, le telechargement normal est introuvable',
    (await away(`/api/media/download?ids=${privateIds.join(',')}`)).status,
    404,
  );
  equal('de dehors, le scan ne se declenche pas', (await away('/api/scan', { method: 'POST' })).status, 404);
  equal('de dehors, la page du lien s ouvre', (await away(`/p/${share.token}`)).status, 200);

  // Le JS et le CSS doivent passer, sinon la page de l'invite reste blanche.
  // On lit le vrai nom du fichier construit : il porte une empreinte qui change
  // a chaque build, et un nom devine ne prouverait rien.
  const assetDir = path.join('web', 'dist', 'assets');
  const asset = fs.existsSync(assetDir)
    ? fs.readdirSync(assetDir).find((f) => f.endsWith('.js'))
    : undefined;
  if (asset) {
    equal('de dehors, le JS de l interface se charge', (await away(`/assets/${asset}`)).status, 200);
  } else {
    check('de dehors, le JS de l interface se charge', false, 'web/dist absent : lancez npm run build');
  }
  equal('mais pas le listing du dossier', (await away('/assets/')).status, 404);
  equal('ni un chemin qui tente de remonter', (await away('/assets/..%2f..%2fpackage.json')).status, 404);

  console.log('\n3. L invite voit son album, et rien d autre');
  const info = await json<{ open: boolean; name: string; count: number; allowDownload: boolean }>(
    await away(`/api/share/${share.token}`),
  );
  check('le lien s ouvre sans mot de passe', info.open);
  equal('il porte le nom de l album', info.name, 'Vacances a partager');
  equal('et compte ses trois photos', info.count, 3);

  const media = await json<Array<{ id: number; favorite: boolean; tags: string[] }>>(
    await away(`/api/share/${share.token}/media`),
  );
  equal('la liste rend trois photos', media.length, 3);
  check(
    'exactement celles de l album',
    media.every((m) => shared.includes(m.id)) && media.length === shared.length,
  );
  check('sans les favoris de la maison', media.every((m) => m.favorite === false));
  check('sans les tags', media.every((m) => m.tags.length === 0));

  console.log('\n4. Les tentatives d evasion');
  for (const id of privateIds) {
    equal(
      `la vignette de la photo privee ${id} est refusee`,
      (await away(`/api/share/${share.token}/thumb/${id}`)).status,
      404,
    );
    equal(
      `le fichier de la photo privee ${id} est refuse`,
      (await away(`/api/share/${share.token}/file/${id}`)).status,
      404,
    );
  }
  equal(
    'une photo de l album est bien servie',
    (await away(`/api/share/${share.token}/file/${shared[0]}`)).status,
    200,
  );
  equal(
    'un telechargement groupe filtre les photos privees',
    (await away(`/api/share/${share.token}/download?ids=${privateIds.join(',')}`)).status,
    404,
  );
  equal(
    'un jeton inconnu donne 404, pas 403',
    (await away(`/api/share/${'0'.repeat(64)}`)).status,
    404,
  );
  equal(
    'un jeton mal forme aussi',
    (await away('/api/share/pas-un-jeton')).status,
    404,
  );
  equal(
    'et la page d un jeton mal forme n est pas servie',
    (await away('/p/pas-un-jeton')).status,
    404,
  );

  console.log('\n5. Le ZIP contient exactement les bonnes photos');
  // Le point le plus concret du partage : la personne repart avec des fichiers
  // identiques aux originaux, et avec ceux-la seulement. On ouvre vraiment
  // l archive et on compare les empreintes, plutot que de se fier a sa taille.
  const zipRes = await away(`/api/share/${share.token}/download`);
  equal('l archive est servie', zipRes.status, 200);
  const zipFile = path.join(ROOT, 'emporte.zip');
  fs.writeFileSync(zipFile, Buffer.from(await zipRes.arrayBuffer()));

  const listed = execFileSync('unzip', ['-Z1', zipFile], { encoding: 'utf-8' })
    .split('\n').map((l) => l.trim()).filter(Boolean).sort();
  const expected = (() => {
    const placeholders = shared.map(() => '?').join(',');
    const database = new DatabaseCtor(path.join(DATA, 'photon', 'photon.db'), { readonly: true });
    const rows = database
      .prepare(`SELECT filename, path FROM media WHERE id IN (${placeholders})`)
      .all(...shared) as Array<{ filename: string; path: string }>;
    database.close();
    return rows;
  })();
  equal('elle contient trois fichiers', listed.length, 3);
  check(
    'portant les noms de l album',
    listed.join('|') === expected.map((r) => r.filename).sort().join('|'),
    `archive : ${listed.join(', ')}`,
  );

  const outDir = path.join(ROOT, 'extrait');
  execFileSync('unzip', ['-qo', zipFile, '-d', outDir]);
  let identical = 0;
  for (const row of expected) {
    const original = crypto.createHash('sha256').update(fs.readFileSync(row.path)).digest('hex');
    const copy = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(outDir, row.filename))).digest('hex');
    if (original === copy) identical++;
  }
  equal('chaque fichier est identique a l original, octet pour octet', identical, 3);

  console.log('\n6. Un lien protege par mot de passe');
  const locked = await json<Share>(
    await home(`/api/albums/${album.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Protege', password: 'grand-mere-2026', days: 0 }),
    }),
  );
  check('le lien declare un mot de passe', locked.hasPassword);

  const before = await json<{ needsPassword: boolean; open: boolean; name?: string }>(
    await away(`/api/share/${locked.token}`),
  );
  check('il demande le mot de passe', before.needsPassword && !before.open);
  equal('et ne dit pas le nom de l album', before.name, undefined);

  equal(
    'la liste des photos est refusee sans mot de passe',
    (await away(`/api/share/${locked.token}/media`)).status,
    401,
  );
  equal(
    'et les fichiers aussi',
    (await away(`/api/share/${locked.token}/file/${shared[0]}`)).status,
    401,
  );

  const wrong = await away(`/api/share/${locked.token}/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'pas-le-bon' }),
  });
  equal('un mauvais mot de passe est refuse', wrong.status, 401);

  const good = await away(`/api/share/${locked.token}/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'grand-mere-2026' }),
  });
  equal('le bon est accepte', good.status, 200);
  const cookie = good.headers.get('set-cookie') ?? '';
  check('un cookie de session est pose', cookie.includes('photon_share='));
  check('il est httpOnly', cookie.toLowerCase().includes('httponly'));

  const session = cookie.split(';')[0];
  const opened = await json<{ open: boolean; name: string }>(
    await away(`/api/share/${locked.token}`, { headers: { cookie: session } }),
  );
  check('avec la session, le lien s ouvre', opened.open);
  equal('et donne le nom', opened.name, 'Vacances a partager');

  console.log('\n7. Une session ne deverrouille pas un autre lien');
  // Troisième lien, autre mot de passe : la session du deuxième ne doit rien y
  // faire. Sans le lien session-jeton, ouvrir un album en ouvrirait tous.
  const other = await json<Share>(
    await home(`/api/albums/${album.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Un autre', password: 'autre-chose' }),
    }),
  );
  equal(
    'la session du premier lien ne vaut pas pour le second',
    (await away(`/api/share/${other.token}/media`, { headers: { cookie: session } })).status,
    401,
  );

  console.log('\n8. Telechargement interdit');
  const noDownload = await json<Share>(
    await home(`/api/albums/${album.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Lecture seule', allowDownload: false }),
    }),
  );
  const seul = await json<{ allowDownload: boolean }>(await away(`/api/share/${noDownload.token}`));
  equal('le lien l annonce', seul.allowDownload, false);
  equal(
    'et la route refuse',
    (await away(`/api/share/${noDownload.token}/download`)).status,
    403,
  );
  equal(
    'mais regarder reste possible',
    (await away(`/api/share/${noDownload.token}/file/${shared[0]}`)).status,
    200,
  );

  console.log('\n9. Expiration et revocation');
  const brief = await json<Share>(
    await home(`/api/albums/${album.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'Court', days: 7 }),
    }),
  );
  equal('le lien marche', (await away(`/api/share/${brief.token}`)).status, 200);

  // On recule la date d'expiration dans la base : impossible d'attendre sept
  // jours, et c'est le seul moyen de franchir vraiment la limite.
  const db = new DatabaseCtor(path.join(DATA, 'photon', 'photon.db'));
  db.prepare(`UPDATE shares SET expires_at = ? WHERE token = ?`).run(Date.now() - 1000, brief.token);
  db.close();
  equal('expire, il ne marche plus', (await away(`/api/share/${brief.token}`)).status, 404);
  equal(
    'et ses fichiers non plus',
    (await away(`/api/share/${brief.token}/file/${shared[0]}`)).status,
    404,
  );

  equal(
    'revoquer depuis la maison repond',
    (await home(`/api/shares/${share.token}`, { method: 'DELETE' })).status,
    200,
  );
  equal('le lien revoque est introuvable', (await away(`/api/share/${share.token}`)).status, 404);

  console.log('\n10. La maison garde la main');
  const list = await json<Share[]>(await home(`/api/albums/${album.id}/shares`));
  check('la liste des liens se lit', Array.isArray(list) && list.length >= 3, `${list.length} liens`);
  equal('de dehors, cette liste est introuvable', (await away(`/api/albums/${album.id}/shares`)).status, 404);
  equal(
    'de dehors, on ne cree pas de lien',
    (await away(`/api/albums/${album.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'pirate' }),
    })).status,
    404,
  );

  console.log('\n11. Pas de lien sur un album automatique');
  const albums = await json<Album[]>(await home('/api/albums'));
  const recent = albums.find((a) => a.kind === 'recent');
  equal(
    '« cette semaine » refuse d etre partage',
    (await home(`/api/albums/${recent?.id}/shares`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: 'non' }),
    })).status,
    400,
  );

  console.log('\n12. Les essais de mot de passe sont freines');
  const target = other.token;
  let refused429 = 0;
  for (let i = 0; i < 14; i++) {
    const res = await fetch(`${BASE}/api/share/${target}/open`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: PUBLIC_HOST,
        'cf-connecting-ip': '198.51.100.44',
        'x-forwarded-for': '198.51.100.44',
      },
      body: JSON.stringify({ password: `essai-${i}` }),
    });
    if (res.status === 429) refused429++;
  }
  check('au bout de dix essais, on est bloque', refused429 >= 3, `${refused429} refus 429`);

  // Un autre visiteur ne doit pas payer pour celui-là : derrière un tunnel,
  // tout le monde arrive de 127.0.0.1, et c'est cf-connecting-ip qui distingue.
  const neighbour = await fetch(`${BASE}/api/share/${target}/open`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: PUBLIC_HOST,
      'cf-connecting-ip': '198.51.100.99',
      'x-forwarded-for': '198.51.100.99',
    },
    body: JSON.stringify({ password: 'autre-chose' }),
  });
  equal('un autre visiteur n est pas puni pour lui', neighbour.status, 200);
}

void (async () => {
  try {
    await main();

    console.log('\n13. Les fichiers sont intacts');
    const fingerprint = (): Map<string, string> => {
      const out = new Map<string, string>();
      const walk = (at: string): void => {
        for (const entry of fs.readdirSync(at, { withFileTypes: true })) {
          const full = path.join(at, entry.name);
          if (entry.isDirectory()) walk(full);
          else out.set(
            path.relative(PHOTOS, full),
            crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex'),
          );
        }
      };
      walk(PHOTOS);
      return out;
    };
    const before = fingerprint();
    // Tout ce qu'un invité peut faire, y compris emporter une copie.
    const live = await json<Share[]>(await home('/api/albums/3/shares')).catch(() => []);
    for (const s of live) {
      await away(`/api/share/${s.token}/download`).catch(() => undefined);
    }
    const after = fingerprint();
    equal('meme nombre de fichiers', after.size, before.size);
    let changed = 0;
    for (const [file, hash] of before) if (after.get(file) !== hash) changed++;
    equal('aucun fichier modifie', changed, 0);
    check('la bibliotheque n est pas vide', after.size > 0);
  } catch (err) {
    fail++;
    console.log(`\n  FAIL exception — ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  } finally {
    stopServer();
    fs.rmSync(ROOT, { recursive: true, force: true });
  }

  console.log(`\n${pass} verifications passees, ${fail} echouees`);
  process.exit(fail === 0 ? 0 : 1);
})();
