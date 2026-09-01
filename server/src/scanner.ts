import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import exifr from 'exifr';
import type { ScanStatus } from '../../shared/types.js';
import { db } from './db.js';
import { reverseGeocode } from './geocode.js';
import { PHOTO_EXT, SKIP_DIRS, thumbPath, VIDEO_EXT } from './paths.js';
import { makeThumbs, probeVideo, removeThumbs } from './thumbs.js';
import { signatureFromThumb } from './vision.js';
import { clipStatus, embedImage, load as loadClip } from './clip/model.js';
import { saveEmbedding } from './clip/search.js';
import { removeProxy } from './transcode.js';

export const status: ScanStatus = {
  running: false,
  phase: 'idle',
  found: 0,
  indexed: 0,
  thumbsDone: 0,
  thumbsTotal: 0,
  sigDone: 0,
  sigTotal: 0,
  clipDone: 0,
  clipTotal: 0,
  startedAt: null,
  finishedAt: null,
  error: null,
};

type Listener = () => void;
const listeners = new Set<Listener>();
export function onScanProgress(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * Beaucoup de photos n'ont pas d'EXIF (captures d'écran, fichiers recompressés,
 * exports de messagerie) mais gardent la date dans leur nom. On la récupère avant
 * de se rabattre sur la date de modification, qui ment dès qu'on copie un dossier.
 */
function dateFromFilename(name: string): number | null {
  const patterns = [
    /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[-_ T]?(\d{2})[-_.:]?(\d{2})[-_.:]?(\d{2})/,
    /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})/,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (!m) continue;
    const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map((v) => Number(v ?? 0));
    if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const t = new Date(y, mo - 1, d, h || 12, mi || 0, s || 0).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

interface WalkResult {
  file: string;
  bytes: number;
  mtime: number;
}

async function* walk(dir: string, depth = 0): AsyncGenerator<WalkResult> {
  if (depth > 24) return;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      yield* walk(full, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!PHOTO_EXT.has(ext) && !VIDEO_EXT.has(ext)) continue;
    try {
      const st = await fs.promises.stat(full);
      yield { file: full, bytes: st.size, mtime: Math.round(st.mtimeMs) };
    } catch {
      /* fichier disparu entre readdir et stat */
    }
  }
}

interface ExtractedMeta {
  takenAt: number;
  takenSource: 'exif' | 'filename' | 'mtime';
  width: number | null;
  height: number | null;
  duration: number | null;
  lat: number | null;
  lon: number | null;
  camera: string | null;
  vcodec: string | null;
  acodec: string | null;
}

async function extract(file: string, kind: 'photo' | 'video', mtime: number): Promise<ExtractedMeta> {
  const meta: ExtractedMeta = {
    takenAt: mtime,
    takenSource: 'mtime',
    width: null,
    height: null,
    duration: null,
    lat: null,
    lon: null,
    camera: null,
    vcodec: null,
    acodec: null,
  };

  if (kind === 'photo') {
    try {
      const exif = (await exifr.parse(file, {
        tiff: true,
        exif: true,
        gps: true,
        translateValues: true,
        reviveValues: true,
      })) as Record<string, unknown> | undefined;

      if (exif) {
        const date =
          (exif.DateTimeOriginal as Date | undefined) ??
          (exif.CreateDate as Date | undefined) ??
          (exif.ModifyDate as Date | undefined);
        if (date instanceof Date && !Number.isNaN(date.getTime())) {
          meta.takenAt = date.getTime();
          meta.takenSource = 'exif';
        }
        const w = (exif.ExifImageWidth ?? exif.ImageWidth) as number | undefined;
        const h = (exif.ExifImageHeight ?? exif.ImageHeight) as number | undefined;
        if (typeof w === 'number') meta.width = w;
        if (typeof h === 'number') meta.height = h;
        if (typeof exif.latitude === 'number' && typeof exif.longitude === 'number') {
          meta.lat = exif.latitude;
          meta.lon = exif.longitude;
        }
        const make = typeof exif.Make === 'string' ? exif.Make.trim() : '';
        const model = typeof exif.Model === 'string' ? exif.Model.trim() : '';
        const camera = model.startsWith(make) ? model : [make, model].filter(Boolean).join(' ');
        if (camera) meta.camera = camera;
      }
    } catch {
      /* pas d'EXIF exploitable */
    }
  } else {
    const probe = await probeVideo(file);
    meta.duration = probe.duration;
    meta.width = probe.width;
    meta.height = probe.height;
    meta.vcodec = probe.vcodec;
    meta.acodec = probe.acodec;
    if (probe.createdAt) {
      meta.takenAt = probe.createdAt;
      meta.takenSource = 'exif';
    }
  }

  if (meta.takenSource === 'mtime') {
    const fromName = dateFromFilename(path.basename(file));
    if (fromName) {
      meta.takenAt = fromName;
      meta.takenSource = 'filename';
    }
  }
  return meta;
}

const selectByPath = db.prepare(`SELECT id, mtime, bytes, thumb_state FROM media WHERE path = ?`);
const insertMedia = db.prepare(`
  INSERT INTO media (path, root_id, filename, kind, ext, bytes, mtime, taken_at, taken_source,
                     width, height, duration, lat, lon, place_city, place_admin, place_country,
                     camera, vcodec, acodec, thumb_state, missing, added_at)
  VALUES (@path, @rootId, @filename, @kind, @ext, @bytes, @mtime, @takenAt, @takenSource,
          @width, @height, @duration, @lat, @lon, @city, @admin, @country,
          @camera, @vcodec, @acodec, 'pending', 0, @addedAt)
`);
const updateMedia = db.prepare(`
  UPDATE media SET bytes = @bytes, mtime = @mtime, taken_at = @takenAt, taken_source = @takenSource,
    width = @width, height = @height, duration = @duration, lat = @lat, lon = @lon,
    place_city = @city, place_admin = @admin, place_country = @country, camera = @camera,
    vcodec = @vcodec, acodec = @acodec,
    thumb_state = 'pending', missing = 0
  WHERE id = @id
`);

async function indexFile(rootId: number, found: WalkResult): Promise<void> {
  const existing = selectByPath.get(found.file) as
    | { id: number; mtime: number; bytes: number; thumb_state: string }
    | undefined;

  // Fichier connu et inchangé : on le remet juste « présent » et on passe.
  if (existing && existing.mtime === found.mtime && existing.bytes === found.bytes) {
    db.prepare(`UPDATE media SET missing = 0, root_id = ? WHERE id = ?`).run(rootId, existing.id);
    return;
  }

  const ext = path.extname(found.file).toLowerCase();
  const kind: 'photo' | 'video' = VIDEO_EXT.has(ext) ? 'video' : 'photo';
  const meta = await extract(found.file, kind, found.mtime);

  let city: string | null = null;
  let admin: string | null = null;
  let country: string | null = null;
  if (meta.lat !== null && meta.lon !== null) {
    const place = await reverseGeocode(meta.lat, meta.lon);
    if (place) {
      city = place.city;
      admin = place.admin;
      country = place.country;
    }
  }

  const row = {
    path: found.file,
    rootId,
    filename: path.basename(found.file),
    kind,
    ext,
    bytes: found.bytes,
    mtime: found.mtime,
    takenAt: meta.takenAt,
    takenSource: meta.takenSource,
    width: meta.width,
    height: meta.height,
    duration: meta.duration,
    lat: meta.lat,
    lon: meta.lon,
    city,
    admin,
    country,
    camera: meta.camera,
    vcodec: meta.vcodec,
    acodec: meta.acodec,
    addedAt: Date.now(),
  };

  if (existing) {
    updateMedia.run({ ...row, id: existing.id });
    await removeThumbs(existing.id);
    // Le fichier a changé : sa copie de lecture ne le représente plus.
    await removeProxy(existing.id);
  } else {
    insertMedia.run(row);
  }
}

async function buildPendingThumbs(): Promise<void> {
  status.phase = 'thumbnails';
  const pending = db
    .prepare(
      `SELECT id, path, kind, rotation FROM media WHERE thumb_state = 'pending' AND missing = 0`,
    )
    .all() as Array<{ id: number; path: string; kind: 'photo' | 'video'; rotation: number }>;

  status.thumbsTotal = pending.length;
  status.thumbsDone = 0;
  notify();

  // La signature est calculée depuis la vignette : refaire l'une périme l'autre.
  const markReady = db.prepare(
    `UPDATE media SET thumb_state = ?, sig_state = 'pending' WHERE id = ?`,
  );
  const workers = Math.max(2, Math.min(4, os.cpus().length - 1));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const item = pending[cursor++];
      const ok = await makeThumbs(item.id, item.path, item.kind, item.rotation);
      markReady.run(ok ? 'ready' : 'failed', item.id);
      status.thumbsDone++;
      if (status.thumbsDone % 10 === 0 || status.thumbsDone === pending.length) notify();
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * Signe les photos qui ne le sont pas encore. On lit la vignette de 240 px et
 * non l'original : quelques millisecondes par photo au lieu de plusieurs
 * dixièmes de seconde, pour un résultat identique à cette échelle.
 *
 * Une bibliothèque déjà indexée passe donc ici une seule fois, sans que ses
 * vignettes soient refaites.
 */
async function buildPendingSignatures(): Promise<void> {
  status.phase = 'signatures';
  const pending = db
    .prepare(
      `SELECT id FROM media
        WHERE sig_state = 'pending' AND missing = 0 AND thumb_state = 'ready'`,
    )
    .all() as Array<{ id: number }>;

  status.sigTotal = pending.length;
  status.sigDone = 0;
  notify();
  if (pending.length === 0) return;

  const save = db.prepare(
    `UPDATE media SET sig_state = 'ready', sig_grid = @grid, sig_phash = @phash,
       sig_light = @light, sig_sat = @sat, sig_colorful = @colorful, sig_hue = @hue
     WHERE id = @id`,
  );
  const fail = db.prepare(`UPDATE media SET sig_state = 'failed' WHERE id = ?`);

  const workers = Math.max(2, Math.min(4, os.cpus().length - 1));
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      const { id } = pending[cursor++];
      const sig = await signatureFromThumb(id);
      if (sig) save.run({ id, ...sig });
      else fail.run(id);
      status.sigDone++;
      if (status.sigDone % 25 === 0 || status.sigDone === pending.length) notify();
    }
  }

  await Promise.all(Array.from({ length: workers }, () => worker()));
}

/**
 * Calcule les vecteurs CLIP des photos qui n'en ont pas.
 *
 * Ne fait rien si le modèle n'est pas installé : c'est une fonctionnalité qu'on
 * ajoute si on veut, et son absence ne doit jamais ralentir un scan ordinaire.
 *
 * On part de la vignette de 960 px, largement au-dessus des 224 px attendus, ce
 * qui évite de redécoder un original de vingt-quatre mégapixels par photo. Un
 * seul fil : l'inférence occupe déjà tous les cœurs.
 */
async function buildPendingEmbeddings(): Promise<void> {
  if (!clipStatus().files) return;
  if (!(await loadClip())) return;

  status.phase = 'clip';
  const pending = db
    .prepare(
      `SELECT id FROM media
        WHERE clip_state = 'pending' AND missing = 0 AND kind = 'photo'
          AND thumb_state = 'ready'`,
    )
    .all() as Array<{ id: number }>;

  status.clipTotal = pending.length;
  status.clipDone = 0;
  notify();
  if (pending.length === 0) return;

  for (const { id } of pending) {
    const file = thumbPath(id, 960);
    try {
      const source = await fs.promises.readFile(file);
      saveEmbedding(id, await embedImage(source));
    } catch {
      db.prepare(`UPDATE media SET clip_state = 'failed' WHERE id = ?`).run(id);
    }
    status.clipDone++;
    if (status.clipDone % 10 === 0 || status.clipDone === pending.length) notify();
  }
}

export async function scan(): Promise<void> {
  if (status.running) return;
  status.running = true;
  status.phase = 'walking';
  status.found = 0;
  status.indexed = 0;
  status.thumbsDone = 0;
  status.thumbsTotal = 0;
  status.sigDone = 0;
  status.sigTotal = 0;
  status.clipDone = 0;
  status.clipTotal = 0;
  status.startedAt = Date.now();
  status.finishedAt = null;
  status.error = null;
  notify();

  try {
    // Le dossier de réception est aussi une source de photos : ce qu'on y range
    // doit apparaître dans la bibliothèque sans avoir à l'ajouter deux fois.
    const roots = db
      .prepare(`SELECT id, path FROM roots WHERE kind IN ('photos', 'import')`)
      .all() as Array<{ id: number; path: string }>;

    // Tout est présumé disparu ; le parcours remet à 0 ce qu'il retrouve.
    db.prepare(`UPDATE media SET missing = 1`).run();

    status.phase = 'indexing';
    for (const root of roots) {
      if (!fs.existsSync(root.path)) continue;
      for await (const found of walk(root.path)) {
        status.found++;
        await indexFile(root.id, found);
        status.indexed++;
        if (status.indexed % 25 === 0) notify();
      }
    }
    notify();
    await buildPendingThumbs();
    await buildPendingSignatures();
    await buildPendingEmbeddings();

    status.phase = 'done';
    status.finishedAt = Date.now();
  } catch (err) {
    status.error = err instanceof Error ? err.message : String(err);
    status.phase = 'idle';
  } finally {
    status.running = false;
    notify();
  }
}

// ------------------------------------------------------------ surveillance

let watchers: fs.FSWatcher[] = [];
let watchTimer: NodeJS.Timeout | null = null;

/**
 * Surveille les dossiers pour que les photos déposées par un autre outil —
 * une appli de synchronisation, un glisser-déposer, un câble — apparaissent
 * en quelques secondes sans qu'on relance un scan à la main.
 *
 * Le délai avant réaction sert à laisser une copie en cours se terminer, et à
 * ne pas déclencher cent scans quand cent fichiers arrivent d'un coup.
 */
export function restartWatching(onChange: () => void | Promise<void>): void {
  for (const watcher of watchers) watcher.close();
  watchers = [];

  const roots = db
    .prepare(`SELECT path FROM roots WHERE kind IN ('photos', 'import')`)
    .all() as Array<{ path: string }>;

  for (const root of roots) {
    if (!fs.existsSync(root.path)) continue;
    try {
      const watcher = fs.watch(root.path, { recursive: true }, () => {
        if (watchTimer) clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          watchTimer = null;
          void onChange();
        }, 3000);
      });
      watcher.on('error', () => {});
      watchers.push(watcher);
    } catch {
      // Certains systèmes de fichiers refusent la surveillance récursive
      // (partages réseau, montages exotiques). Le scan manuel reste possible.
      console.warn(`[watch] surveillance impossible pour ${root.path}`);
    }
  }
}

/**
 * Rejoue le géocodage sur tous les médias qui ont des coordonnées. Sert d'outil
 * de réparation : premier scan lancé avant que la base de villes soit prête, ou
 * lieux calculés par une version antérieure de l'heuristique.
 */
export async function backfillPlaces(): Promise<number> {
  const rows = db
    .prepare(`SELECT id, lat, lon FROM media WHERE lat IS NOT NULL`)
    .all() as Array<{ id: number; lat: number; lon: number }>;
  const update = db.prepare(
    `UPDATE media SET place_city = ?, place_admin = ?, place_country = ? WHERE id = ?`,
  );
  let done = 0;
  for (const row of rows) {
    const place = await reverseGeocode(row.lat, row.lon);
    if (place) {
      update.run(place.city, place.admin, place.country, row.id);
      done++;
    }
  }
  return done;
}
