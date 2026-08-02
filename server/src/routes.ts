import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Album, AppState, Root } from '../../shared/types.js';
import { ADMIN_COOKIE, createSession, destroySession, isAdmin, isPasswordSet, requireAdmin, setPassword, verifyPassword } from './auth.js';
import { db, FAVORITES_ID, pruneOrphanTags, tagId } from './db.js';
import {
  dateBounds, distinctPlaces, getMedia, histogram, queryMedia, randomFavorite, type Filters,
} from './media-query.js';
import { PORT, thumbPath } from './paths.js';
import { backfillPlaces, onScanProgress, scan, status as scanStatus } from './scanner.js';
import { getSettings, saveSettings } from './settings.js';
import { nearestThumbSize, removeThumbs } from './thumbs.js';

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

function filtersFrom(query: Record<string, unknown>, admin: boolean): Filters {
  const showHidden = getSettings().showHidden;
  return {
    from: parseNum(query.from),
    to: parseNum(query.to),
    tags: parseList(query.tags),
    place: typeof query.place === 'string' && query.place ? query.place : undefined,
    album: parseNum(query.album),
    kind: query.kind === 'photo' || query.kind === 'video' ? query.kind : undefined,
    // Les photos masquées ne réapparaissent que si un admin l'a demandé.
    includeHidden: admin && showHidden,
  };
}

function albumRows(): Album[] {
  const rows = db
    .prepare(
      `SELECT a.id, a.name, a.color, a.music_slot AS musicSlot, a.kind,
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
       FROM albums a
       ORDER BY a.kind = 'favorites' DESC, a.updated_at DESC`,
    )
    .all() as Array<Omit<Album, 'tags'>>;

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

  return rows.map((a) => ({ ...a, tags: byAlbum.get(a.id) ?? [] }));
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

export function registerRoutes(app: FastifyInstance): void {
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

    return {
      settings,
      albums: albumRows(),
      tags: (db.prepare(`SELECT name FROM tags ORDER BY name`).all() as Array<{ name: string }>).map(
        (t) => t.name,
      ),
      places: distinctPlaces(settings.lang).map((p) => p.city),
      roots: admin ? rootRows() : [],
      isAdmin: admin,
      adminPasswordSet: isPasswordSet(),
      scan: scanStatus,
      counts: { photos: counts.photos ?? 0, videos: counts.videos ?? 0, hidden: counts.hidden ?? 0 },
      musicSlots: availableMusicSlots(),
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

  // ------------------------------------------------------------------- albums

  app.get('/api/albums', async () => albumRows());

  app.post('/api/albums', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = req.body as { name?: string; color?: number; musicSlot?: number | null; tags?: string[] };
    const name = (body.name ?? '').trim();
    if (!name) return reply.code(400).send({ error: 'name_required' });

    const now = Date.now();
    const info = db
      .prepare(
        `INSERT INTO albums (name, color, music_slot, kind, created_at, updated_at)
         VALUES (?, ?, ?, 'user', ?, ?)`,
      )
      .run(name, Math.round(body.color ?? getSettings().hue), body.musicSlot ?? null, now, now);
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
      name?: string; color?: number; musicSlot?: number | null;
      coverMediaId?: number | null; tags?: string[];
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
    if (body.coverMediaId !== undefined) {
      sets.push('cover_media_id = ?');
      params.push(body.coverMediaId);
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
    return rootRows();
  });

  app.delete('/api/roots/:id', async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const id = Number((req.params as { id: string }).id);
    db.prepare(`DELETE FROM roots WHERE id = ?`).run(id);
    // Les médias de ce dossier sortent des vues sans qu'on touche aux fichiers.
    db.prepare(`UPDATE media SET missing = 1 WHERE root_id = ?`).run(id);
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
    for (const id of ids) await removeThumbs(id);
    const stmt = db.prepare(`UPDATE media SET thumb_state = 'pending' WHERE id = ?`);
    for (const id of ids) stmt.run(id);
    void scan();
    return { queued: ids.length };
  });

  // ------------------------------------------------------------------ musique

  app.get('/api/music/:slot', async (req, reply) => {
    const slot = Number((req.params as { slot: string }).slot);
    const file = musicFile(slot);
    if (!file) return reply.code(404).send({ error: 'no_track' });
    return sendFile(req, reply, file);
  });

  app.get('/api/health', async () => ({ ok: true, port: PORT }));
}
