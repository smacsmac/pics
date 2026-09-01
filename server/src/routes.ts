import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Album, AlbumSort, AppState, Mood, Root, UploadResult } from '../../shared/types.js';
import { MOODS } from '../../shared/types.js';
import {
  drainInbox, ensureTempDir, fileIntoLibrary, importRoot, isKnownNameSize, safeName, TEMP_DIR,
} from './import.js';
import {
  ADMIN_COOKIE, createSession, destroySession, hasSession, isAdmin, isChildMode, isPasswordSet,
  requireAdmin, setChildMode, setPassword, verifyPassword,
} from './auth.js';
import { db, FAVORITES_ID, pruneOrphanTags, tagId } from './db.js';
import {
  chapters, dateBounds, distinctPlaces, duplicateGroups, getMedia, getMediaByIds, histogram,
  onThisDay, queryMedia, randomFavorite, type Filters,
} from './media-query.js';
import { PORT, thumbPath } from './paths.js';
import { backfillPlaces, onScanProgress, scan, status as scanStatus } from './scanner.js';
import { getSettings, saveSettings } from './settings.js';
import { nearestThumbSize, removeThumbs } from './thumbs.js';
import { playbackInfo, proxyFile, removeProxy } from './transcode.js';
import { zipStream } from './zip.js';
import {
  clipStatus, embedText, install as clipInstall, load as clipLoad, uninstall as clipUninstall,
} from './clip/model.js';
import { progress as clipProgress, rank as rankClip } from './clip/search.js';

/** Plafond d'un téléchargement groupé : au-delà, mieux vaut copier le dossier. */
const DOWNLOAD_MAX = 2000;

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff',
  '.tiff': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg', '.3gp': 'video/3gpp', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
};

function parseList(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const list = value.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function parseNum(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Un pourcentage saisi à la main : on borne plutôt que de rejeter. */
function clampPercent(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function filtersFrom(query: Record<string, unknown>, admin: boolean): Filters {
  // La requête fait foi quand elle le précise : l'interface bascule le réglage
  // et recharge dans la foulée, sans attendre que l'enregistrement soit fini.
  const showHidden =
    query.showHidden === undefined ? getSettings().showHidden : query.showHidden === '1';
  return {
    from: parseNum(query.from),
    to: parseNum(query.to),
    tags: parseList(query.tags),
    place: typeof query.place === 'string' && query.place ? query.place : undefined,
    album: parseNum(query.album),
    kind: query.kind === 'photo' || query.kind === 'video' ? query.kind : undefined,
    mood: MOODS.includes(query.mood as Mood) ? (query.mood as Mood) : undefined,
    similar: parseNum(query.similar),
    ids: parseList(query.ids)?.map(Number).filter((n) => Number.isFinite(n)),
    // Les photos masquées ne réapparaissent que si un admin l'a demandé.
    includeHidden: admin && showHidden,
  };
}

/**
 * Année écrite dans le nom d'un album (« Vacances 2026 » → 2026). C'est ainsi
 * que les albums sont nommés en pratique, et ça vaut mieux que la date de
 * création pour les ranger. Sans année lisible, l'album passe en fin de liste.
 */
function yearInName(name: string): number | null {
  // Encadré par des non-chiffres : sans ça « Sortie 662068 » se lirait 2068.
  const matches = name.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g);
  if (!matches) return null;
  // Le dernier : « Noël 2025 chez mamie 2024 » reste un cas tordu, mais le plus
  // souvent l'année finale est la bonne.
  return Number(matches[matches.length - 1]);
}

function sortAlbums(albums: Album[], order: AlbumSort): Album[] {
  const byName = (a: Album, b: Album): number => a.name.localeCompare(b.name, undefined, { numeric: true });

  const compare = (a: Album, b: Album): number => {
    if (order === 'name') return byName(a, b);
    if (order === 'yearDesc' || order === 'yearAsc') {
      const ya = yearInName(a.name);
      const yb = yearInName(b.name);
      // Les albums sans année ne se mélangent pas aux autres : ils suivent.
      if (ya === null && yb === null) return byName(a, b);
      if (ya === null) return 1;
      if (yb === null) return -1;
      if (ya !== yb) return order === 'yearDesc' ? yb - ya : ya - yb;
      return byName(a, b);
    }
    return b.updatedAt - a.updatedAt;
  };

  // Les favoris d'abord, puis les épinglés, puis le tri demandé.
  return [...albums].sort((a, b) => {
    if ((a.kind === 'favorites') !== (b.kind === 'favorites')) return a.kind === 'favorites' ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return compare(a, b);
  });
}

function albumRows(): Album[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.color, a.music_slot AS musicSlot, a.kind,
              a.video_music_pct AS videoMusicPct,
              a.background, a.background_opacity AS backgroundOpacity,
              a.pinned,
              a.created_at AS createdAt, a.updated_at AS updatedAt,
              -- Sans couverture choisie, on prend la photo la plus récente de l'album.
              COALESCE(a.cover_media_id, (
                SELECT am.media_id FROM album_media am
                JOIN media m ON m.id = am.media_id
                WHERE am.album_id = a.id AND m.missing = 0 AND m.hidden = 0
                ORDER BY m.taken_at DESC LIMIT 1
              )) AS coverMediaId,
              (SELECT COUNT(*) FROM album_media am JOIN media m ON m.id = am.media_id
                WHERE am.album_id = a.id AND m.missing = 0) AS count
       FROM albums a`,
    )
    .all() as Array<Omit<Album, 'tags' | 'pinned'> & { pinned: number }>;

  const tagRows = db
    .prepare(
      `SELECT at.album_id AS id, t.name FROM album_tags at
       JOIN tags t ON t.id = at.tag_id ORDER BY t.name`,
    )
    .all() as Array<{ id: number; name: string }>;
  const byAlbum = new Map<number, string[]>();
  for (const row of tagRows) {
    const list = byAlbum.get(row.id);
    if (list) list.push(row.name);
    else byAlbum.set(row.id, [row.name]);
  }

  const albums = rows.map((a) => ({
    ...a,
    pinned: a.pinned === 1,
    tags: byAlbum.get(a.id) ?? [],
  }));
  return sortAlbums(albums, getSettings().albumSort);
}

const BACKGROUND_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.bmp']);

/**
 * Images disponibles comme arrière-plan d'album, prises dans le dossier
 * « images d'interface ». On ne renvoie que des noms de fichiers : le chemin
 * complet ne quitte jamais le serveur.
 */
function backgroundNames(): string[] {
  const root = db.prepare(`SELECT path FROM roots WHERE kind = 'ui' LIMIT 1`).get() as
    | { path: string }
    | undefined;
  if (!root) return [];
  try {
    return fs
      .readdirSync(root.path, { withFileTypes: true })
      .filter((e) => e.isFile() && BACKGROUND_EXT.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 200);
  } catch {
    return [];
  }
}

/**
 * Résout un nom d'arrière-plan en chemin. On exige une correspondance exacte
 * avec un fichier réellement listé : aucun « ../ » ne peut passer.
 */
function backgroundPath(name: string): string | null {
  if (!backgroundNames().includes(name)) return null;
  const root = db.prepare(`SELECT path FROM roots WHERE kind = 'ui' LIMIT 1`).get() as
    | { path: string }
    | undefined;
  return root ? path.join(root.path, name) : null;
}

/** Les fichiers 1.mp3 … 5.mp3 du dossier musique, tels que l'utilisateur les nomme. */
function musicFile(slot: number): string | null {
  const root = db.prepare(`SELECT path FROM roots WHERE kind = 'music' LIMIT 1`).get() as
    | { path: string }
    | undefined;
  if (!root) return null;
  for (const ext of ['.mp3', '.m4a', '.ogg', '.wav', '.flac']) {
    const candidate = path.join(root.path, `${slot}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function availableMusicSlots(): number[] {
  return [1, 2, 3, 4, 5].filter((slot) => musicFile(slot) !== null);
}

function rootRows(): Root[] {
  const rows = db.prepare(`SELECT id, path, kind FROM roots ORDER BY kind, id`).all() as Array<
    Omit<Root, 'exists'>
  >;
  return rows.map((r) => ({ ...r, exists: fs.existsSync(r.path) }));
}

/**
 * En-tête `content-disposition` pour un nom de fichier quelconque. Les accents
 * (« Été 2019.jpg ») ne passent pas en ASCII : on donne une version dépouillée
 * pour les vieux navigateurs, et le vrai nom encodé en UTF-8 à côté.
 */
function attachment(filename: string): string {
  const plain = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Envoie un fichier avec support des requêtes Range (indispensable pour les vidéos). */
async function sendFile(req: FastifyRequest, reply: FastifyReply, file: string): Promise<void> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(file);
  } catch {
    return reply.code(404).send({ error: 'not_found' });
  }

  const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  const range = req.headers.range;
  void reply.header('accept-ranges', 'bytes').header('content-type', type);

  if (range) {
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start >= stat.size || start > end) {
        return reply.code(416).header('content-range', `bytes */${stat.size}`).send();
      }
      return reply
        .code(206)
        .header('content-range', `bytes ${start}-${end}/${stat.size}`)
        .header('content-length', end - start + 1)
        .send(fs.createReadStream(file, { start, end }));
    }
  }

  return reply.header('content-length', stat.size).send(fs.createReadStream(file));
}

/** Appelé quand la liste des dossiers change, pour resynchroniser la surveillance. */
export function registerRoutes(app: FastifyInstance, onRootsChanged: () => void = () => {}): void {
  // ---------------------------------------------------------------- état global

  app.get('/api/state', async (req): Promise<AppState> => {
    const admin = isAdmin(req);
    const settings = getSettings();
    const counts = db
      .prepare(
        `SELECT
          SUM(kind = 'photo' AND hidden = 0) AS photos,
          SUM(kind = 'video' AND hidden = 0) AS videos,
          SUM(hidden = 1) AS hidden
         FROM media WHERE missing = 0`,
      )
      .get() as { photos: number | null; videos: number | null; hidden: number | null };

    const tagRows = db.prepare(`SELECT name, color FROM tags ORDER BY name`).all() as Array<{
      name: string;
      color: number | null;
    }>;
    const tagColors: Record<string, number> = {};
    for (const row of tagRows) {
      if (row.color !== null) tagColors[row.name] = row.color;
    }

    return {
      settings,
      albums: albumRows(),
      tags: tagRows.map((r) => r.name),
      tagColors,
      places: distinctPlaces(settings.lang).map((p) => p.city),
      roots: admin ? rootRows() : [],
      isAdmin: admin,
      childMode: isChildMode(),
      adminPasswordSet: isPasswordSet(),
      scan: scanStatus,
      counts: { photos: counts.photos ?? 0, videos: counts.videos ?? 0, hidden: counts.hidden ?? 0 },
      musicSlots: availableMusicSlots(),
      backgrounds: backgroundNames(),
      bounds: dateBounds(),
    };
  });

  app.get('/api/places', async (req) => {
    void req;
    return distinctPlaces(getSettings().lang);
  });

  // ------------------------------------------------------------------- médias

  app.get('/api/media', async (req) => {
    const query = req.query as Record<string, unknown>;
    const limit = Math.min(500, Math.max(1, parseNum(query.limit) ?? 200));
    const cursor = typeof query.cursor === 'string' ? query.cursor : undefined;
    return queryMedia(filtersFrom(query, isAdmin(req)), cursor, limit, getSettings().lang);
  });

  app.get('/api/media/histogram', async (req) => {
    const query = req.query as Record<string, unknown>;
    return histogram(filtersFrom(query, isAdmin(req)));
  });

  app.get('/api/media/random-favorite', async () => ({ id: randomFavorite() }));

  app.get('/api/media/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const item = getMedia(id, getSettings().lang);
    if (!item) return reply.code(404).send({ error: 'not_found' });
    return item;
  });

  app.get('/api/thumb/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const size = nearestThumbSize(parseNum((req.query as { s?: string }).s) ?? 480);
    const file = thumbPath(id, size);
    if (!fs.existsSync(file)) {
      // La vignette n'est pas encore prête : 404 court, l'interface réessaiera.
      return reply.code(404).header('cache-control', 'no-store').send({ error: 'not_ready' });
    }
    void reply.header('cache-control', 'public, max-age=31536000, immutable');
    return sendFile(req, reply, file);
  });

  app.get('/api/file/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const row = db.prepare(`SELECT path FROM media WHERE id = ?`).get(id) as
      | { path: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return sendFile(req, reply, row.path);
  });

  /**
   * Enregistrer une sélection sur l'appareil qui regarde. Une seule photo part
   * telle quelle ; plusieurs sont empaquetées dans un ZIP écrit au fil de l'eau,
   * sans fichier temporaire.
   *
   * C'est une copie, rien d'autre : les fichiers d'origine ne sont ni déplacés,
   * ni renommés, ni effacés.
   */
  app.get('/api/media/download', async (req, reply) => {
    const admin = isAdmin(req);
    const ids = (parseList((req.query as { ids?: string }).ids) ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .slice(0, DOWNLOAD_MAX);
    if (ids.length === 0) return reply.code(400).send({ error: 'no_ids' });

    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, path, filename, mtime, hidden FROM media
          WHERE id IN (${placeholders}) AND missing = 0`,
      )
      .all(...ids) as Array<{
        id: number; path: string; filename: string; mtime: number; hidden: number;
      }>;

    // Une photo cachée ne s'exporte pas en mode enfant : elle est cachée.
    const allowed = rows.filter((r) => admin || r.hidden === 0);
    if (allowed.length === 0) return reply.code(404).send({ error: 'not_found' });

    // On respecte l'ordre demandé par l'interface, pas celui de SQLite.
    const byId = new Map(allowed.map((r) => [r.id, r]));
    const picked = ids.map((id) => byId.get(id)).filter((r) => r !== undefined);

    if (picked.length === 1) {
      const only = picked[0];
      void reply.header('content-disposition', attachment(only.filename));
      return sendFile(req, reply, only.path);
    }

    const stamp = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/zip')
      .header('cache-control', 'no-store')
      .header('content-disposition', attachment(`photon-${stamp}.zip`))
      .send(
        zipStream(
          picked.map((r) => ({
            path: r.path,
            name: r.filename,
            mtime: new Date(r.mtime || Date.now()),
          })),
        ),
      );
  });

  /**
   * Comment lire cette vidéo ? Réponse immédiate : soit le fichier d'origine
   * convient, soit une copie H.264 est prête, soit elle est en préparation et
   * l'interface affiche l'avancement.
   */
  app.get('/api/media/:id/playback', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const info = await playbackInfo(id);
    if (!info) return reply.code(404).send({ error: 'not_found' });
    return reply.header('cache-control', 'no-store').send(info);
  });

  /** La copie lisible d'une vidéo. L'original n'est jamais modifié. */
  app.get('/api/file/:id/proxy', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const file = proxyFile(id);
    if (!file) return reply.code(404).send({ error: 'not_ready' });
    return sendFile(req, reply, file);
  });

  /**
   * « Masquer » remplace la suppression : le fichier reste intact sur le disque,
   * on le retire seulement des vues. Réversible depuis les réglages admin.
   */
  app.post('/api/media/hide', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { ids?: number[]; hidden?: boolean };
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return { changed: 0 };
    const hidden = body.hidden !== false ? 1 : 0;
    const stmt = db.prepare(`UPDATE media SET hidden = ? WHERE id = ?`);
    const run = db.transaction((list: number[]) => {
      for (const id of list) stmt.run(hidden, id);
    });
    run(ids);
    return { changed: ids.length, hidden: hidden === 1 };
  });

  app.post('/api/media/tags', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { ids?: number[]; add?: string[]; remove?: string[] };
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return { changed: 0 };

    const run = db.transaction(() => {
      for (const name of body.add ?? []) {
        if (!name.trim()) continue;
        const tid = tagId(name);
        const stmt = db.prepare(`INSERT OR IGNORE INTO media_tags (media_id, tag_id) VALUES (?, ?)`);
        for (const id of ids) stmt.run(id, tid);
      }
      for (const name of body.remove ?? []) {
        const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(name.trim()) as
          | { id: number }
          | undefined;
        if (!row) continue;
        const stmt = db.prepare(`DELETE FROM media_tags WHERE media_id = ? AND tag_id = ?`);
        for (const id of ids) stmt.run(id, row.id);
      }
      pruneOrphanTags();
    });
    run();
    return { changed: ids.length };
  });

  // ---------------------------------------------------------------- souvenirs

  /** Le découpage en moments. Recalculé à chaque appel, jamais stocké. */
  app.get('/api/chapters', async (req) => {
    const limit = Math.min(400, Math.max(1, parseNum((req.query as { limit?: string }).limit) ?? 120));
    return chapters(limit);
  });

  /** « Ce jour-là » : les photos prises un même jour, les années précédentes. */
  app.get('/api/media/on-this-day', async () => onThisDay(getSettings().lang));

  // ------------------------------------------------ recherche par description

  /** Où en est le modèle : installé, chargé, en cours de téléchargement. */
  app.get('/api/clip/status', async () => ({ ...clipStatus(), index: clipProgress() }));

  /**
   * Installe le modèle. Seul moment où Photon touche à Internet, et il faut le
   * demander : rien ne se télécharge tout seul.
   */
  app.post('/api/clip/install', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    // On ne fait pas attendre la requête : le téléchargement dure des minutes,
    // l'interface suit l'avancement par /api/clip/status.
    void clipInstall().then((r) => {
      if (r.ok) void scan();
    });
    return { started: true };
  });

  app.post('/api/clip/uninstall', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    await clipUninstall();
    db.prepare(`UPDATE media SET clip_state = 'pending', clip = NULL`).run();
    return { ok: true };
  });

  /**
   * Cherche par description. Renvoie les identifiants les mieux classés ; c'est
   * l'interface qui les affiche, dans l'ordre chronologique comme le reste.
   */
  app.get('/api/clip/search', async (req, reply) => {
    const query = String((req.query as { q?: string }).q ?? '').trim();
    if (!query) return { ids: [], scores: [], ready: clipStatus().ready };
    if (!(await clipLoad())) {
      return reply.code(503).send({ error: 'clip_unavailable', detail: clipStatus().error });
    }
    const vec = await embedText(query);
    if (!vec) return reply.code(503).send({ error: 'clip_unavailable' });

    const limit = Math.min(200, Math.max(1, parseNum((req.query as { limit?: string }).limit) ?? 60));
    const hits = rankClip(vec, limit, isAdmin(req) && getSettings().showHidden);
    return { ids: hits.map((h) => h.id), scores: hits.map((h) => h.score), ready: true };
  });

  /**
   * Les séries de photos quasi identiques. Réservé à l'admin : c'est un outil de
   * ménage, et il mène droit à « cacher ».
   */
  app.get('/api/duplicates', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const limit = Math.min(200, Math.max(1, parseNum((req.query as { limit?: string }).limit) ?? 60));
    return duplicateGroups(limit);
  });

  /** Un lot de photos par identifiants : de quoi lancer un diaporama d'un moment. */
  app.get('/api/media/by-ids', async (req) => {
    const admin = isAdmin(req);
    const ids = (parseList((req.query as { ids?: string }).ids) ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .slice(0, DOWNLOAD_MAX);
    const items = getMediaByIds(ids, getSettings().lang);
    return admin ? items : items.filter((item) => !item.hidden);
  });

  /**
   * Transforme un chapitre en véritable album. Le chapitre n'existe qu'en
   * mémoire et se redécoupera au gré des ajouts ; en faire un album, c'est
   * figer le moment pour de bon.
   */
  app.post('/api/albums/from-chapter', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { name?: string; ids?: number[]; color?: number };
    const name = (body.name ?? '').trim();
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (!name) return reply.code(400).send({ error: 'name_required' });
    if (ids.length === 0) return reply.code(400).send({ error: 'empty_chapter' });

    const now = Date.now();
    const create = db.transaction(() => {
      const info = db
        .prepare(
          `INSERT INTO albums (name, color, music_slot, video_music_pct, background,
                               background_opacity, kind, created_at, updated_at)
           VALUES (?, ?, NULL, 20, NULL, 35, 'user', ?, ?)`,
        )
        .run(name, Math.round(body.color ?? getSettings().hue), now, now);
      const albumId = Number(info.lastInsertRowid);
      const link = db.prepare(
        `INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?, ?, ?)`,
      );
      for (const mediaId of ids) link.run(albumId, mediaId, now);
      return albumId;
    });
    const id = create();
    return { album: albumRows().find((a) => a.id === id), albums: albumRows() };
  });

  // ------------------------------------------------------------------- albums

  app.get('/api/albums', async () => albumRows());

  app.post('/api/albums', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as {
      name?: string; color?: number; musicSlot?: number | null; videoMusicPct?: number;
      background?: string | null; backgroundOpacity?: number; tags?: string[];
    };
    const name = (body.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name_required' });

    const background =
      typeof body.background === 'string' && backgroundPath(body.background) ? body.background : null;

    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO albums (name, color, music_slot, video_music_pct, background,
                             background_opacity, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?)`,
      )
      .run(
        name,
        Math.round(body.color ?? getSettings().hue),
        body.musicSlot ?? null,
        clampPercent(body.videoMusicPct, 20),
        background,
        clampPercent(body.backgroundOpacity, 35),
        now,
        now,
      );
    const id = Number(info.lastInsertRowid);

    for (const tag of body.tags ?? []) {
      if (tag.trim()) {
        db.prepare(`INSERT OR IGNORE INTO album_tags (album_id, tag_id) VALUES (?, ?)`).run(id, tagId(tag));
      }
    }
    return albumRows().find((a) => a.id === id);
  });

  app.patch('/api/albums/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const body = req.body as {
      name?: string; color?: number; musicSlot?: number | null; videoMusicPct?: number;
      background?: string | null; backgroundOpacity?: number;
      coverMediaId?: number | null; tags?: string[]; pinned?: boolean;
    };
    const album = db.prepare(`SELECT id, kind FROM albums WHERE id = ?`).get(id) as
      | { id: number; kind: string }
      | undefined;
    if (!album) return reply.code(404).send({ error: 'not_found' });

    const sets: string[] = [];
    const params: unknown[] = [];
    // Le nom de l'album favoris est fourni par les traductions, on ne le stocke pas.
    if (body.name !== undefined && album.kind !== 'favorites' && body.name.trim()) {
      sets.push('name = ?');
      params.push(body.name.trim());
    }
    if (body.color !== undefined) {
      sets.push('color = ?');
      params.push(Math.round(body.color));
    }
    if (body.musicSlot !== undefined) {
      sets.push('music_slot = ?');
      params.push(body.musicSlot);
    }
    if (body.videoMusicPct !== undefined) {
      sets.push('video_music_pct = ?');
      params.push(clampPercent(body.videoMusicPct, 20));
    }
    if (body.background !== undefined) {
      // null efface l'arrière-plan ; un nom inconnu est refusé silencieusement.
      const name = body.background === null ? null : String(body.background);
      sets.push('background = ?');
      params.push(name !== null && backgroundPath(name) ? name : null);
    }
    if (body.backgroundOpacity !== undefined) {
      sets.push('background_opacity = ?');
      params.push(clampPercent(body.backgroundOpacity, 35));
    }
    if (body.coverMediaId !== undefined) {
      sets.push('cover_media_id = ?');
      params.push(body.coverMediaId);
    }
    if (body.pinned !== undefined) {
      sets.push('pinned = ?');
      params.push(body.pinned ? 1 : 0);
    }
    sets.push('updated_at = ?');
    params.push(Date.now(), id);
    db.prepare(`UPDATE albums SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    if (body.tags) {
      db.prepare(`DELETE FROM album_tags WHERE album_id = ?`).run(id);
      for (const tag of body.tags) {
        if (tag.trim()) {
          db.prepare(`INSERT OR IGNORE INTO album_tags (album_id, tag_id) VALUES (?, ?)`).run(id, tagId(tag));
        }
      }
      pruneOrphanTags();
    }
    return albumRows().find((a) => a.id === id);
  });

  app.delete('/api/albums/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    if (id === FAVORITES_ID) return reply.code(400).send({ error: 'cannot_delete_favorites' });
    db.prepare(`DELETE FROM albums WHERE id = ?`).run(id);
    pruneOrphanTags();
    return { deleted: id };
  });

  app.post('/api/albums/:id/media', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    const body = req.body as { ids?: number[]; remove?: boolean };
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return { changed: 0 };

    const run = db.transaction(() => {
      if (body.remove) {
        const stmt = db.prepare(`DELETE FROM album_media WHERE album_id = ? AND media_id = ?`);
        for (const mediaId of ids) stmt.run(id, mediaId);
      } else {
        const stmt = db.prepare(
          `INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?, ?, ?)`,
        );
        const now = Date.now();
        for (const mediaId of ids) stmt.run(id, mediaId, now);
      }
      db.prepare(`UPDATE albums SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
    });
    run();
    return { changed: ids.length, albums: albumRows() };
  });

  // --------------------------------------------------------------------- tags

  /**
   * Couleur d'un tag : une teinte 0-359, ou null pour revenir au neutre. On ne
   * colore que des tags existants — un tag qui ne sert plus à rien est effacé
   * par le nettoyage, sa couleur avec.
   */
  app.post('/api/tags/color', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { name?: string; color?: number | null };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return reply.code(400).send({ error: 'missing_name' });

    const color =
      body.color === null || body.color === undefined
        ? null
        : ((Math.round(Number(body.color)) % 360) + 360) % 360;

    db.prepare(`UPDATE tags SET color = ? WHERE name = ?`).run(color, name);
    return { name, color };
  });

  /**
   * Quels tags portent déjà les médias sélectionnés ? « all » = présents sur
   * tous, « some » = sur une partie seulement. Sans ça l'éditeur de tags
   * s'ouvrait vide et on ne voyait pas ce que la photo avait déjà.
   */
  app.get('/api/media/tag-summary', async (req) => {
    const ids = (parseList((req.query as { ids?: string }).ids) ?? [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) return { all: [], some: [] };

    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT t.name, COUNT(DISTINCT mt.media_id) AS n
           FROM media_tags mt JOIN tags t ON t.id = mt.tag_id
          WHERE mt.media_id IN (${placeholders})
          GROUP BY t.id ORDER BY t.name`,
      )
      .all(...ids) as Array<{ name: string; n: number }>;

    return {
      all: rows.filter((r) => r.n === ids.length).map((r) => r.name),
      some: rows.filter((r) => r.n < ids.length).map((r) => r.name),
    };
  });

  /**
   * Tourner une photo d'un quart de tour. Le fichier d'origine n'est jamais
   * réécrit : on note l'angle, on refait les vignettes, et l'affichage
   * l'applique. Une photo tournée par erreur se remet droite en tournant
   * jusqu'au bout, sans aucune perte de qualité.
   */
  app.post('/api/media/rotate', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { ids?: number[]; delta?: number };
    const ids = (body.ids ?? []).filter((n) => Number.isFinite(n));
    if (ids.length === 0) return { changed: 0 };

    // Un quart de tour par défaut, dans le sens des aiguilles d'une montre.
    const step = Number.isFinite(body.delta) ? Math.round(Number(body.delta) / 90) * 90 : 90;

    const read = db.prepare(`SELECT rotation, kind FROM media WHERE id = ?`);
    const write = db.prepare(`UPDATE media SET rotation = ?, thumb_state = 'pending' WHERE id = ?`);
    let changed = 0;
    for (const id of ids) {
      const row = read.get(id) as { rotation: number; kind: string } | undefined;
      // Les vidéos garderaient leur orientation d'origine à la lecture : les
      // tourner ne donnerait qu'une vignette de travers par rapport au film.
      if (!row || row.kind !== 'photo') continue;
      write.run((((row.rotation + step) % 360) + 360) % 360, id);
      changed++;
    }
    // Les vignettes marquées « pending » sont refaites par le scan.
    if (changed > 0) void scan();
    return { changed };
  });

  app.get('/api/tags', async () =>
    (
      db
        .prepare(
          `SELECT t.name, COUNT(mt.media_id) AS count FROM tags t
           LEFT JOIN media_tags mt ON mt.tag_id = t.id
           GROUP BY t.id ORDER BY t.name`,
        )
        .all() as Array<{ name: string; count: number }>
    ),
  );

  // ----------------------------------------------------------------- réglages

  app.put('/api/settings', async (req) => saveSettings(req.body as Record<string, never>));

  // -------------------------------------------------------------------- admin

  app.post('/api/admin/login', async (req, reply) => {
    const { password } = req.body as { password?: string };
    if (!isPasswordSet()) {
      // Premier démarrage : la première saisie devient le mot de passe.
      if (!password || password.length < 4) return reply.code(400).send({ error: 'password_too_short' });
      setPassword(password);
    } else if (!password || !verifyPassword(password)) {
      return reply.code(401).send({ error: 'bad_password' });
    }
    const token = createSession();
    void reply.setCookie(ADMIN_COOKIE, token, {
      path: '/', httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60,
    });
    return { ok: true };
  });

  app.post('/api/admin/logout', async (req, reply) => {
    destroySession(req.cookies?.[ADMIN_COOKIE]);
    void reply.clearCookie(ADMIN_COOKIE, { path: '/' });
    return { ok: true };
  });

  /**
   * Mode enfant. L'entrée est libre — on veut pouvoir brider l'application en
   * un geste avant de la tendre à un enfant. La sortie demande le mot de passe,
   * sinon le mode ne protégerait rien.
   */
  app.post('/api/admin/child-mode', async (req, reply) => {
    const { on } = req.body as { on?: boolean };
    if (on) {
      setChildMode(true);
      return { childMode: true };
    }
    if (isPasswordSet() && !hasSession(req)) {
      return reply.code(403).send({ error: 'admin_required' });
    }
    setChildMode(false);
    return { childMode: false };
  });

  app.post('/api/admin/password', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { next } = req.body as { next?: string };
    if (!next || next.length < 4) return reply.code(400).send({ error: 'password_too_short' });
    setPassword(next);
    return { ok: true };
  });

  app.get('/api/roots', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return rootRows();
  });

  app.post('/api/roots', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { path?: string; kind?: Root['kind'] };
    const target = (body.path ?? '').trim();
    const kind = body.kind ?? 'photos';
    if (!target) return reply.code(400).send({ error: 'path_required' });
    if (!fs.existsSync(target)) return reply.code(400).send({ error: 'path_not_found' });
    if (!fs.statSync(target).isDirectory()) return reply.code(400).send({ error: 'not_a_directory' });
    // Un seul dossier musique et un seul dossier d'images d'interface.
    if (kind !== 'photos') db.prepare(`DELETE FROM roots WHERE kind = ?`).run(kind);
    db.prepare(`INSERT OR IGNORE INTO roots (path, kind) VALUES (?, ?)`).run(target, kind);
    onRootsChanged();
    return rootRows();
  });

  app.delete('/api/roots/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    db.prepare(`DELETE FROM roots WHERE id = ?`).run(id);
    // Les médias de ce dossier sortent des vues sans qu'on touche aux fichiers.
    db.prepare(`UPDATE media SET missing = 1 WHERE root_id = ?`).run(id);
    onRootsChanged();
    return rootRows();
  });

  app.post('/api/scan', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    void scan();
    return { started: true };
  });

  app.post('/api/scan/backfill-places', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return { updated: await backfillPlaces() };
  });

  /** Flux d'avancement du scan, poussé au navigateur (Server-Sent Events). */
  app.get('/api/scan/stream', async (req, reply) => {
    void reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    const send = (): void => {
      reply.raw.write(`data: ${JSON.stringify(scanStatus)}\n\n`);
    };
    send();
    const off = onScanProgress(send);
    const keepAlive = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      off();
      clearInterval(keepAlive);
    });
    return reply;
  });

  app.post('/api/media/rebuild-thumbs', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const ids = ((req.body as { ids?: number[] }).ids ?? []).filter((n) => Number.isFinite(n));
    for (const id of ids) {
      await removeThumbs(id);
      await removeProxy(id);
    }
    const stmt = db.prepare(`UPDATE media SET thumb_state = 'pending' WHERE id = ?`);
    for (const id of ids) stmt.run(id);
    void scan();
    return { queued: ids.length };
  });

  // ------------------------------------------------------------------ musique

  // ------------------------------------------------------- envoi de photos

  /**
   * Pré-vérification : le téléphone annonce ce qu'il s'apprête à envoyer, le
   * serveur répond ce qu'il connaît déjà. Ça permet de sélectionner « toutes
   * les photos » à chaque fois sans retransférer la bibliothèque entière.
   */
  app.post('/api/upload/check', async (req) => {
    const files = (req.body as { files?: Array<{ name: string; size: number }> }).files ?? [];
    return {
      known: files.map((f) => isKnownNameSize(safeName(f.name ?? ''), Number(f.size) || 0)),
      ready: importRoot() !== null,
    };
  });

  app.post('/api/upload', async (req, reply) => {
    if (getSettings().uploadRequiresAdmin && !requireAdmin(req, reply)) return;
    if (!importRoot()) return reply.code(400).send({ error: 'no_import_folder' });

    ensureTempDir();
    const results: UploadResult[] = [];

    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const temp = path.join(TEMP_DIR, `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      // Écriture en flux : une vidéo de 300 Mo ne doit jamais tenir en mémoire.
      await pipeline(part.file, fs.createWriteStream(temp));

      if (part.file.truncated) {
        await fs.promises.rm(temp, { force: true });
        results.push({ name: part.filename ?? '?', outcome: 'rejected' });
        continue;
      }

      // La date du fichier arrive en paramètre d'URL : dans un corps multipart
      // elle devrait précéder le fichier pour être lisible ici, ce qui est
      // fragile. Elle ne sert que de secours quand l'EXIF manque.
      const stamp = Number((req.query as { mtime?: string }).mtime);
      const mtime = Number.isFinite(stamp) && stamp > 0 ? new Date(stamp) : new Date();
      const result = await fileIntoLibrary(temp, part.filename ?? 'photo', mtime);
      results.push({ name: result.name, outcome: result.outcome });
    }

    if (results.some((r) => r.outcome === 'stored')) void scan();
    return { results };
  });

  app.post('/api/inbox/drain', async () => {
    const results = await drainInbox();
    if (results.some((r) => r.outcome === 'stored')) void scan();
    return { results };
  });

  app.get('/api/backgrounds', async () => backgroundNames());

  app.get('/api/background', async (req, reply) => {
    const name = (req.query as { name?: string }).name ?? '';
    const file = backgroundPath(name);
    if (!file) return reply.code(404).send({ error: 'not_found' });
    void reply.header('cache-control', 'public, max-age=3600');
    return sendFile(req, reply, file);
  });

  app.get('/api/music/:slot', async (req, reply) => {
    const slot = Number((req.params as { slot: string }).slot);
    const file = musicFile(slot);
    if (!file) return reply.code(404).send({ error: 'no_track' });
    return sendFile(req, reply, file);
  });

  app.get('/api/health', async () => ({ ok: true, port: PORT }));
}
