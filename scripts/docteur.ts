/**
 * Bilan de sante de Photon.  `npm run docteur`
 *
 * Repond a une seule question : est-ce que tout est en place, et sinon, que
 * faut-il faire ? Chaque verification est isolee — un composant casse ne doit
 * pas empecher les autres d'etre examines, sans quoi le bilan s'arreterait au
 * premier probleme au lieu de les montrer tous.
 *
 * Le texte n'a volontairement aucun accent : la console de Windows les affiche
 * de travers selon sa page de codes, et un rapport de diagnostic illisible ne
 * sert a rien. `start.bat` suit la meme regle.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DATA_DIR, DB_PATH, PORT, THUMB_DIR } from '../server/src/paths.js';

const run = promisify(execFile);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Etat = 'ok' | 'attention' | 'probleme';

interface Ligne {
  etat: Etat;
  quoi: string;
  detail: string;
  /** Quoi faire. Affiche seulement si ce n'est pas « ok ». */
  remede?: string;
}

const lignes: Ligne[] = [];
const dire = (etat: Etat, quoi: string, detail: string, remede?: string): void => {
  lignes.push({ etat, quoi, detail, remede });
};

/** Taille d'un fichier, ou -1 s'il n'existe pas. */
function taille(f: string): number {
  try {
    return fs.statSync(f).size;
  } catch {
    return -1;
  }
}

function mo(octets: number): string {
  return octets >= 1024 * 1024
    ? `${(octets / 1024 / 1024).toFixed(1)} Mo`
    : `${Math.round(octets / 1024)} Ko`;
}

// ------------------------------------------------------------------ node

{
  const version = process.versions.node;
  const majeur = Number(version.split('.')[0]);
  if (majeur >= 20) dire('ok', 'Node.js', `version ${version}`);
  else {
    dire('probleme', 'Node.js', `version ${version}, trop ancienne`,
      'Installez la version LTS depuis https://nodejs.org, puis relancez.');
  }
}

// --------------------------------------------------- dependances natives

if (!fs.existsSync(path.join(racine, 'node_modules'))) {
  dire('probleme', 'Dependances', 'node_modules est absent',
    'Lancez : npm install');
} else {
  // On charge chaque paquet natif pour de vrai. Verifier la presence d'un
  // fichier ne dit pas s'il se charge : un binaire compile pour une autre
  // version de Node existe bel et bien, et echoue quand meme.
  try {
    const { default: Database } = await import('better-sqlite3');
    const essai = new Database(':memory:');
    essai.exec('CREATE TABLE t (a)');
    essai.close();
    dire('ok', 'Base de donnees', 'better-sqlite3 se charge et repond');
  } catch (err) {
    dire('probleme', 'Base de donnees', abrege(err),
      'Le module natif manque ou ne correspond pas a votre version de Node.\n' +
      '       npm install-scripts approve better-sqlite3\n' +
      '       npm install');
  }

  try {
    const { default: sharp } = await import('sharp');
    await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } })
      .jpeg().toBuffer();
    dire('ok', 'Images', 'sharp se charge et encode');
  } catch (err) {
    dire('probleme', 'Images', abrege(err), 'Lancez : npm install');
  }
}

// --------------------------------------------------------------- ffmpeg

{
  let trouve = '';
  try {
    const mod = await import('ffmpeg-static');
    const bin = (mod.default ?? mod) as unknown as string | null;
    if (bin && taille(bin) > 1024 * 1024) trouve = bin;
  } catch {
    /* on essaie le PATH juste apres */
  }

  if (trouve) {
    dire('ok', 'Videos (ffmpeg)', `${mo(taille(trouve))} - ffmpeg-static`);
  } else {
    // Photon sait se servir d'un ffmpeg du systeme : ce n'est donc pas bloquant.
    const systeme = await essayer(process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    if (systeme) dire('ok', 'Videos (ffmpeg)', 'trouve dans le PATH du systeme');
    else {
      dire('attention', 'Videos (ffmpeg)', 'introuvable',
        'Les vignettes de videos et la lecture des videos de telephone ne\n' +
        '       marcheront pas. Le reste fonctionne.\n' +
        '       npm install-scripts approve ffmpeg-static\n' +
        '       npm install');
    }
  }
}

// ------------------------------------------------------------- interface

{
  const index = path.join(racine, 'web', 'dist', 'index.html');
  if (fs.existsSync(index)) {
    const actifs = fs.readdirSync(path.join(racine, 'web', 'dist', 'assets')).length;
    dire('ok', 'Interface construite', `web/dist, ${actifs} fichiers`);
  } else {
    dire('probleme', 'Interface construite', 'web/dist est absent',
      'Lancez : npm run build\n' +
      '       Si la construction echoue : npm install-scripts approve esbuild');
  }
}

// -------------------------------------------------- donnees et biblioteque

{
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const temoin = path.join(DATA_DIR, '.docteur');
    fs.writeFileSync(temoin, 'x');
    fs.rmSync(temoin);
    dire('ok', 'Dossier de donnees', DATA_DIR);
  } catch (err) {
    dire('probleme', 'Dossier de donnees', `${DATA_DIR} - ${abrege(err)}`,
      'Photon ne peut pas y ecrire. Verifiez les droits du dossier.');
  }

  const octets = taille(DB_PATH);
  if (octets < 0) {
    dire('attention', 'Bibliotheque', 'aucune base - Photon n\'a jamais demarre ici',
      'C\'est normal a la premiere utilisation. Lancez start.bat.');
  } else {
    await bilanBibliotheque(octets);
  }
}

// ------------------------------------------- recherche par description

{
  const dossierClip = path.join(DATA_DIR, 'clip');
  const modele = path.join(dossierClip, 'model.onnx');
  const vocab = path.join(dossierClip, 'bpe_simple_vocab_16e6.txt.gz');

  let moteur = false;
  try {
    const nom = 'onnxruntime-node';
    await import(nom);
    moteur = true;
  } catch {
    moteur = false;
  }

  if (!moteur) {
    dire('attention', 'Recherche par description', 'onnxruntime-node absent',
      'Facultatif. Pour l\'activer :\n' +
      '       npm install onnxruntime-node\n' +
      '       npm install-scripts approve onnxruntime-node\n' +
      '       npm install\n' +
      '       puis Parametres > Recherche par description > Telecharger le modele');
  } else if (taille(modele) < 1024 * 1024 || taille(vocab) < 1024) {
    dire('attention', 'Recherche par description', 'moteur pret, modele absent',
      'Ouvrez Photon > Parametres > Recherche par description > Telecharger le modele');
  } else {
    dire('ok', 'Recherche par description',
      `moteur present, modele ${mo(taille(modele))}`);
  }
}

// ------------------------------------------------------------------ port

{
  try {
    const reponse = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
      signal: AbortSignal.timeout(1500),
    });
    const corps = (await reponse.json()) as { ok?: boolean };
    if (corps.ok) dire('ok', `Port ${PORT}`, 'Photon tourne deja');
    else dire('attention', `Port ${PORT}`, 'occupe par autre chose',
      'Fermez l\'autre programme, ou changez de port : set PHOTON_PORT=7788');
  } catch {
    dire('ok', `Port ${PORT}`, 'libre');
  }
}

// ------------------------------------------------------------- affichage

const marque: Record<Etat, string> = { ok: '[ ok ]', attention: '[ !  ]', probleme: '[ XX ]' };
const large = Math.max(...lignes.map((l) => l.quoi.length));

console.log('');
console.log('  Photon - bilan de sante');
console.log(`  ${os.type()} ${os.release()} - ${racine}`);
console.log('');

for (const l of lignes) {
  console.log(`  ${marque[l.etat]} ${l.quoi.padEnd(large)}  ${l.detail}`);
  if (l.etat !== 'ok' && l.remede) {
    // L'indentation est posee ici : les remedes s'ecrivent sans se soucier de
    // leur alignement, et une ligne mal decalee ne peut pas s'y glisser.
    for (const bout of l.remede.split('\n')) console.log(`         ${bout.trim()}`);
  }
}

const problemes = lignes.filter((l) => l.etat === 'probleme').length;
const attentions = lignes.filter((l) => l.etat === 'attention').length;

console.log('');
if (problemes > 0) {
  console.log(`  ${problemes} probleme(s) a regler avant que Photon demarre.`);
} else if (attentions > 0) {
  console.log(`  Photon fonctionne. ${attentions} point(s) facultatif(s) ci-dessus.`);
} else {
  console.log('  Tout est en place.');
}
console.log('');
process.exit(problemes > 0 ? 1 : 0);

// ------------------------------------------------------------- outillage

/** Le debut d'un message d'erreur : le reste est du bruit dans un bilan. */
function abrege(err: unknown): string {
  const texte = err instanceof Error ? err.message : String(err);
  const ligne = texte.split('\n')[0];
  return ligne.length > 90 ? `${ligne.slice(0, 90)}...` : ligne;
}

/** Le binaire repond-il ? On lui demande sa version, c'est sans effet de bord. */
async function essayer(bin: string): Promise<boolean> {
  try {
    await run(bin, ['-version'], { timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ce que contient la bibliotheque, et ce qui reste a faire. Ouvert en lecture
 * seule : le docteur ne modifie jamais rien.
 */
async function bilanBibliotheque(octets: number): Promise<void> {
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

    const compte = (sql: string): number =>
      ((db.prepare(sql).get() as { n: number } | undefined)?.n ?? 0);

    const photos = compte(`SELECT COUNT(*) AS n FROM media WHERE missing = 0 AND kind = 'photo'`);
    const videos = compte(`SELECT COUNT(*) AS n FROM media WHERE missing = 0 AND kind = 'video'`);
    const perdus = compte(`SELECT COUNT(*) AS n FROM media WHERE missing = 1`);
    dire('ok', 'Bibliotheque',
      `${photos} photos, ${videos} videos - base de ${mo(octets)}`);

    if (perdus > 0) {
      dire('attention', 'Fichiers introuvables', `${perdus} media(s) plus a leur place`,
        'Un disque externe debranche, ou des fichiers deplaces hors de Photon.\n' +
        '       Ils reviendront tout seuls si le dossier redevient accessible.');
    }

    // Les dossiers surveilles : c'est la panne la plus frequente apres un
    // deplacement de fichiers ou un changement de lettre de lecteur.
    const racines = db
      .prepare(`SELECT path, kind FROM roots ORDER BY kind`)
      .all() as Array<{ path: string; kind: string }>;
    if (racines.length === 0) {
      dire('attention', 'Dossiers de photos', 'aucun dossier configure',
        'Ouvrez Photon > Parametres > Dossiers, et ajoutez votre dossier de photos.');
    } else {
      const absents = racines.filter((r) => !fs.existsSync(r.path));
      if (absents.length === 0) {
        dire('ok', 'Dossiers de photos', `${racines.length} dossier(s), tous accessibles`);
      } else {
        dire('probleme', 'Dossiers de photos',
          `${absents.length} sur ${racines.length} introuvable(s)`,
          absents.map((r) => `${r.path}  (${r.kind})`).join('\n       ') +
          '\n       Rebranchez le disque, ou corrigez le chemin dans Parametres > Dossiers.');
      }
    }

    const vignettes = compte(`SELECT COUNT(*) AS n FROM media WHERE thumb_state = 'pending' AND missing = 0`);
    const rates = compte(`SELECT COUNT(*) AS n FROM media WHERE thumb_state = 'failed'`);
    if (vignettes > 0) {
      dire('attention', 'Vignettes', `${vignettes} en attente`,
        'Elles se feront au prochain scan. Photon > Parametres > Dossiers > Relancer le scan.');
    } else if (rates > 0) {
      dire('attention', 'Vignettes', `${rates} fichier(s) illisibles`,
        'Ces fichiers sont abimes ou dans un format que Photon ne sait pas ouvrir.');
    } else {
      dire('ok', 'Vignettes', 'toutes faites');
    }

    // Colonnes ajoutees apres coup : une base d'une version anterieure ne les a
    // pas, et l'interroger dessus echouerait.
    const colonnes = (db.prepare(`PRAGMA table_info(media)`).all() as Array<{ name: string }>)
      .map((c) => c.name);

    if (colonnes.includes('sig_state')) {
      const restants = compte(`SELECT COUNT(*) AS n FROM media WHERE sig_state = 'pending' AND missing = 0`);
      if (restants > 0) {
        dire('attention', 'Recherche visuelle', `${restants} photo(s) a analyser`,
          'Cela se fera au prochain scan, en quelques dizaines de secondes.');
      } else {
        dire('ok', 'Recherche visuelle', 'ambiances et ressemblances pretes');
      }
    }

    if (colonnes.includes('clip_state')) {
      const faits = compte(`SELECT COUNT(*) AS n FROM media WHERE clip_state = 'ready'`);
      if (faits > 0 && faits < photos) {
        dire('attention', 'Index des descriptions', `${faits} sur ${photos} photos`,
          'L\'analyse reprend au prochain scan.');
      } else if (faits > 0) {
        dire('ok', 'Index des descriptions', `${faits} photos analysees`);
      }
    }

    db.close();
  } catch (err) {
    dire('probleme', 'Bibliotheque', abrege(err),
      'La base est peut-etre abimee. En dernier recours, fermez Photon et\n' +
      `       renommez ${DB_PATH} : elle sera reconstruite au demarrage.\n` +
      '       Vos photos ne sont pas touchees, seulement l\'index.');
  }

  const vignettes = fs.existsSync(THUMB_DIR)
    ? fs.readdirSync(THUMB_DIR).length
    : 0;
  if (vignettes > 0) dire('ok', 'Cache des vignettes', `${vignettes} dossier(s) dans ${THUMB_DIR}`);
}
