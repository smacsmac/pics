import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import exifr from 'exifr';
import { db } from './db.js';
import { DATA_DIR, PHOTO_EXT, VIDEO_EXT } from './paths.js';

/**
 * Abréviations de mois utilisées pour nommer les dossiers. Volontairement
 * figées et sans accent : le nom d'un dossier ne doit pas changer si on change
 * la langue de l'interface, sinon on se retrouverait avec « 8 - Aout » et
 * « 8 - Aug » côte à côte pour le même mois.
 */
const MONTH_FOLDER = [
  'Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aout', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const TEMP_DIR = path.join(DATA_DIR, 'incoming');

export function ensureTempDir(): void {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/** Le dossier de réception : destination des envois et boîte de dépôt. */
export function importRoot(): string | null {
  const row = db.prepare(`SELECT path FROM roots WHERE kind = 'import' LIMIT 1`).get() as
    | { path: string }
    | undefined;
  return row && fs.existsSync(row.path) ? row.path : null;
}

export function monthFolder(when: Date): string {
  return path.join(String(when.getFullYear()), `${when.getMonth() + 1} - ${MONTH_FOLDER[when.getMonth()]}`);
}

/**
 * Un nom de fichier venant du réseau ne doit jamais pouvoir désigner un autre
 * dossier : on ne garde que le nom de base, purgé de tout ce qui pourrait
 * servir à remonter l'arborescence.
 */
/** Noms réservés par Windows : un fichier ainsi nommé serait ingérable. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/**
 * Caractères interdits par Windows, séparateurs de chemin et caractères de
 * contrôle. Écrits en échappements : la version précédente contenait les
 * octets de contrôle en clair dans le source, invisibles à la relecture.
 */
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f]/g;

export function safeName(raw: string): string {
  // basename écarte déjà tout chemin ; le remplacement neutralise ce qu’un
  // séparateur exotique aurait laissé passer. Les espaces sont conservés :
  // c’est le nom donné par l’appareil, et il est parfaitement légal.
  const base = path.basename(raw.replace(/\\/g, '/'));
  const cleaned = base
    .replace(ILLEGAL, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  const safe = RESERVED.test(cleaned) ? `_${cleaned}` : cleaned;
  return safe.slice(0, 180) || 'photo';
}

export function isMediaName(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return PHOTO_EXT.has(ext) || VIDEO_EXT.has(ext);
}

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

export interface LedgerEntry {
  hash: string;
  filename: string;
  bytes: number;
}

/**
 * Le registre survit à la suppression du fichier : c'est ce qui garantit qu'une
 * photo effacée sur le PC ne sera jamais réimportée depuis le téléphone.
 */
export function isKnownHash(hash: string): boolean {
  return db.prepare(`SELECT 1 FROM imported WHERE hash = ?`).get(hash) !== undefined;
}

export function isKnownNameSize(filename: string, bytes: number): boolean {
  const seen = db
    .prepare(`SELECT 1 FROM imported WHERE filename = ? AND bytes = ?`)
    .get(filename, bytes);
  if (seen) return true;
  // Déjà dans la bibliothèque par un autre chemin (copie manuelle, scan) :
  // inutile de le faire remonter par le réseau.
  return (
    db.prepare(`SELECT 1 FROM media WHERE filename = ? AND bytes = ?`).get(filename, bytes) !==
    undefined
  );
}

export function recordImport(entry: LedgerEntry & { storedAt: string | null }): void {
  db.prepare(
    `INSERT INTO imported (hash, filename, bytes, stored_at, imported_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(hash) DO UPDATE SET stored_at = excluded.stored_at`,
  ).run(entry.hash, entry.filename, entry.bytes, entry.storedAt, Date.now());
}

/**
 * Date de prise de vue, pour choisir le dossier de destination.
 *
 * L'extension vient du nom d'origine, jamais du chemin examiné : un fichier
 * reçu par le réseau est écrit sous un nom temporaire sans extension, et se
 * serait donc rangé au mois courant au lieu du mois de la photo.
 */
async function captureDate(file: string, originalName: string, fallback: Date): Promise<Date> {
  const ext = path.extname(originalName).toLowerCase();
  if (!PHOTO_EXT.has(ext)) return fallback;
  try {
    const exif = (await exifr.parse(file, { tiff: true, exif: true, reviveValues: true })) as
      | Record<string, unknown>
      | undefined;
    const date =
      (exif?.DateTimeOriginal as Date | undefined) ?? (exif?.CreateDate as Date | undefined);
    if (date instanceof Date && !Number.isNaN(date.getTime())) return date;
  } catch {
    /* pas d'EXIF : on garde la date fournie */
  }
  return fallback;
}

function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n++;
  }
  return candidate;
}

export type FileOutcome = 'stored' | 'duplicate' | 'rejected';

export interface FileResult {
  name: string;
  outcome: FileOutcome;
  storedAt?: string;
}

/**
 * Range un fichier déjà écrit sur le disque (envoi réseau ou dépôt manuel)
 * dans le dossier du mois correspondant, et l'inscrit au registre.
 * Le fichier source est consommé : déplacé s'il est rangé, effacé si c'est un
 * doublon.
 */
export async function fileIntoLibrary(
  tempFile: string,
  originalName: string,
  mtime: Date,
): Promise<FileResult> {
  const name = safeName(originalName);

  if (!isMediaName(name)) {
    await fs.promises.rm(tempFile, { force: true });
    return { name, outcome: 'rejected' };
  }

  const root = importRoot();
  if (!root) {
    await fs.promises.rm(tempFile, { force: true });
    return { name, outcome: 'rejected' };
  }

  const hash = await hashFile(tempFile);
  if (isKnownHash(hash)) {
    await fs.promises.rm(tempFile, { force: true });
    // On rend quand même l'endroit où le fichier avait été rangé. Il n'est pas
    // réimporté — c'est tout l'intérêt du registre — mais un envoi qui demande
    // un album doit pouvoir y mettre les photos déjà connues : qui sélectionne
    // trente photos d'un voyage les veut toutes dans l'album, pas seulement les
    // quatre que Photon n'avait pas encore.
    const seen = db.prepare(`SELECT stored_at FROM imported WHERE hash = ?`).get(hash) as
      | { stored_at: string | null }
      | undefined;
    return { name, outcome: 'duplicate', storedAt: seen?.stored_at ?? undefined };
  }

  const when = await captureDate(tempFile, name, mtime);
  const dir = path.join(root, monthFolder(when));
  await fs.promises.mkdir(dir, { recursive: true });
  const dest = uniquePath(dir, name);

  try {
    await fs.promises.rename(tempFile, dest);
  } catch {
    // rename échoue entre deux volumes : on copie puis on efface.
    await fs.promises.copyFile(tempFile, dest);
    await fs.promises.rm(tempFile, { force: true });
  }
  await fs.promises.utimes(dest, when, when).catch(() => {});

  recordImport({ hash, filename: name, bytes: (await fs.promises.stat(dest)).size, storedAt: dest });
  return { name, outcome: 'stored', storedAt: dest };
}

// ------------------------------------------- album demandé pendant un envoi

/**
 * Au-delà de ce délai, une photo promise à un album ne l'attend plus.
 *
 * Une attente ne se résout que si le scan retrouve le fichier. Si quelqu'un le
 * supprime du PC avant — ce qui est son droit, et Photon n'y touche pas — la
 * ligne resterait là pour toujours. Une semaine laisse largement le temps à
 * plusieurs scans de passer.
 */
const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * L'album où ranger un envoi, créé au besoin.
 *
 * Un nom déjà pris est réutilisé plutôt que dupliqué : envoyer vingt photos
 * aujourd'hui et trente demain sous le même titre doit donner un album de
 * cinquante photos, pas deux albums homonymes qu'il faudra fusionner à la main.
 * Seuls les albums ordinaires sont candidats — on ne verse pas un envoi dans
 * « Favoris » ni dans « Cette semaine ».
 */
export function albumForUpload(rawName: string, hue: number): number | null {
  const name = rawName.trim().slice(0, 120);
  if (!name) return null;

  const existing = db
    .prepare(`SELECT id FROM albums WHERE kind = 'user' AND name = ? COLLATE NOCASE LIMIT 1`)
    .get(name) as { id: number } | undefined;
  if (existing) return existing.id;

  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO albums (name, color, music_slot, video_music_pct, background,
                           background_opacity, kind, created_at, updated_at)
       VALUES (?, ?, NULL, 20, NULL, 35, 'user', ?, ?)`,
    )
    .run(name, Math.round(hue), now, now);
  return Number(info.lastInsertRowid);
}

/** Note qu'un fichier rangé devra rejoindre un album, dès qu'il sera indexé. */
export function rememberForAlbum(albumId: number, storedAt: string): void {
  db.prepare(
    `INSERT INTO album_pending (path, album_id, added_at) VALUES (?, ?, ?)
     ON CONFLICT(path) DO UPDATE SET album_id = excluded.album_id`,
  ).run(storedAt, albumId, Date.now());
}

/**
 * Verse dans leur album les photos en attente que le scan vient d'indexer.
 *
 * Appelée à la fin de l'indexation, quand les lignes `media` existent mais
 * avant les vignettes : l'album est donc complet dès que les photos sont
 * visibles, sans attendre la fin du traitement d'images.
 */
export function linkPendingAlbums(): number {
  const linked = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT OR IGNORE INTO album_media (album_id, media_id, added_at)
         SELECT p.album_id, m.id, p.added_at
           FROM album_pending p JOIN media m ON m.path = p.path`,
      )
      .run();

    // Résolues ou périmées, on ne garde que ce qui peut encore aboutir.
    db.prepare(`DELETE FROM album_pending WHERE path IN (SELECT path FROM media)`).run();
    db.prepare(`DELETE FROM album_pending WHERE added_at < ?`).run(Date.now() - PENDING_MAX_AGE_MS);

    return info.changes;
  });
  return linked();
}

/**
 * Vide la racine du dossier de réception : tout fichier posé là — par une appli
 * de synchronisation, par un glisser-déposer, par un câble — est rangé dans son
 * mois. Les sous-dossiers ne sont pas touchés : ce sont déjà nos dossiers datés.
 */
export async function drainInbox(): Promise<FileResult[]> {
  const root = importRoot();
  if (!root) return [];

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: FileResult[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !isMediaName(entry.name)) continue;
    const full = path.join(root, entry.name);
    try {
      const stat = await fs.promises.stat(full);
      // Un fichier encore en cours de copie doit être laissé tranquille.
      if (Date.now() - stat.mtimeMs < 2000) continue;
      results.push(await fileIntoLibrary(full, entry.name, stat.mtime));
    } catch {
      /* fichier verrouillé ou disparu : on réessaiera au prochain passage */
    }
  }
  return results;
}
