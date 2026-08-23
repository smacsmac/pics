import type { HistogramBucket, Lang, MediaItem, MediaPage } from '../../shared/types.js';
import { db, FAVORITES_ID } from './db.js';
import { formatPlace } from './geocode.js';

export interface Filters {
  from?: number;
  to?: number;
  tags?: string[];
  place?: string;
  album?: number;
  kind?: 'photo' | 'video';
  includeHidden?: boolean;
}

interface MediaRow {
  id: number;
  kind: 'photo' | 'video';
  filename: string;
  taken_at: number;
  taken_source: 'exif' | 'filename' | 'mtime';
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number;
  place_city: string | null;
  place_admin: string | null;
  place_country: string | null;
  camera: string | null;
  hidden: number;
  rotation: number;
}

const SELECT_COLS = `m.id, m.kind, m.filename, m.taken_at, m.taken_source, m.width, m.height,
  m.duration, m.bytes, m.place_city, m.place_admin, m.place_country, m.camera, m.hidden,
  m.rotation`;

function buildWhere(f: Filters): { sql: string; params: unknown[]; joins: string } {
  const where: string[] = ['m.missing = 0'];
  const params: unknown[] = [];
  let joins = '';

  if (!f.includeHidden) where.push('m.hidden = 0');
  if (f.from !== undefined) {
    where.push('m.taken_at >= ?');
    params.push(f.from);
  }
  if (f.to !== undefined) {
    where.push('m.taken_at <= ?');
    params.push(f.to);
  }
  if (f.kind) {
    where.push('m.kind = ?');
    params.push(f.kind);
  }
  if (f.place) {
    where.push('m.place_city = ?');
    params.push(f.place);
  }
  if (f.album !== undefined) {
    joins += ' JOIN album_media am ON am.media_id = m.id AND am.album_id = ?';
    params.unshift(f.album); // le paramètre du JOIN passe avant ceux du WHERE
  }
  if (f.tags && f.tags.length > 0) {
    // Un média doit porter TOUS les tags demandés, pas au moins un.
    //
    // Un tag posé sur un album vaut pour toutes ses photos : taguer un album
    // « taekwondo » suffit à retrouver ses photos depuis l'accueil, sans avoir
    // à taguer chaque photo une par une.
    //
    // Un EXISTS par tag, tous obligatoires : la recherche s'arrête au premier
    // résultat trouvé, sans bâtir d'index temporaire par photo examinée.
    for (const tag of f.tags) {
      where.push(`(
        EXISTS (
          SELECT 1 FROM media_tags mt
            JOIN tags t ON t.id = mt.tag_id
           WHERE mt.media_id = m.id AND t.name = ?
        )
        OR EXISTS (
          SELECT 1 FROM album_media am
            JOIN album_tags atg ON atg.album_id = am.album_id
            JOIN tags t ON t.id = atg.tag_id
           WHERE am.media_id = m.id AND t.name = ?
        )
      )`);
      params.push(tag, tag);
    }
  }

  return { sql: where.join(' AND '), params, joins };
}

function decorate(rows: MediaRow[], lang: Lang): MediaItem[] {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');

  const tagRows = db
    .prepare(
      `SELECT mt.media_id AS id, t.name FROM media_tags mt
       JOIN tags t ON t.id = mt.tag_id
       WHERE mt.media_id IN (${placeholders}) ORDER BY t.name`,
    )
    .all(...ids) as Array<{ id: number; name: string }>;
  const tagsById = new Map<number, string[]>();
  for (const row of tagRows) {
    const list = tagsById.get(row.id);
    if (list) list.push(row.name);
    else tagsById.set(row.id, [row.name]);
  }

  // Tags hérités des albums, pour les afficher à côté de ceux de la photo.
  const albumTagRows = db
    .prepare(
      `SELECT DISTINCT am.media_id AS id, t.name
         FROM album_media am
         JOIN album_tags atg ON atg.album_id = am.album_id
         JOIN tags t ON t.id = atg.tag_id
        WHERE am.media_id IN (${placeholders}) ORDER BY t.name`,
    )
    .all(...ids) as Array<{ id: number; name: string }>;
  const albumTagsById = new Map<number, string[]>();
  for (const row of albumTagRows) {
    const list = albumTagsById.get(row.id);
    if (list) list.push(row.name);
    else albumTagsById.set(row.id, [row.name]);
  }

  const favRows = db
    .prepare(
      `SELECT media_id AS id FROM album_media WHERE album_id = ? AND media_id IN (${placeholders})`,
    )
    .all(FAVORITES_ID, ...ids) as Array<{ id: number }>;
  const favorites = new Set(favRows.map((r) => r.id));

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    filename: r.filename,
    takenAt: r.taken_at,
    takenSource: r.taken_source,
    width: r.width,
    height: r.height,
    duration: r.duration,
    bytes: r.bytes,
    place: formatPlace(r.place_city, r.place_admin, r.place_country, lang),
    city: r.place_city,
    camera: r.camera,
    hidden: r.hidden === 1,
    rotation: r.rotation ?? 0,
    favorite: favorites.has(r.id),
    tags: tagsById.get(r.id) ?? [],
    // Ce que la photo porte déjà en propre n'est pas répété comme hérité.
    albumTags: (albumTagsById.get(r.id) ?? []).filter(
      (tag) => !(tagsById.get(r.id) ?? []).includes(tag),
    ),
  }));
}

/**
 * Pagination par curseur (taken_at, id) plutôt que par OFFSET : l'interface
 * charge la chronologie au fil du défilement et un OFFSET profond devient
 * quadratique sur une grosse bibliothèque.
 */
export function queryMedia(
  filters: Filters,
  cursor: string | undefined,
  limit: number,
  lang: Lang,
): MediaPage {
  const { sql, params, joins } = buildWhere(filters);
  const extra: unknown[] = [];
  let cursorClause = '';

  if (cursor) {
    const [takenAt, id] = cursor.split('.').map(Number);
    if (Number.isFinite(takenAt) && Number.isFinite(id)) {
      cursorClause = ' AND (m.taken_at < ? OR (m.taken_at = ? AND m.id < ?))';
      extra.push(takenAt, takenAt, id);
    }
  }

  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM media m${joins}
       WHERE ${sql}${cursorClause}
       ORDER BY m.taken_at DESC, m.id DESC
       LIMIT ?`,
    )
    .all(...params, ...extra, limit + 1) as MediaRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM media m${joins} WHERE ${sql}`).get(...params) as {
      n: number;
    }
  ).n;

  return {
    items: decorate(page, lang),
    nextCursor: hasMore && last ? `${last.taken_at}.${last.id}` : null,
    total,
  };
}

export function getMedia(id: number, lang: Lang): MediaItem | null {
  const row = db.prepare(`SELECT ${SELECT_COLS} FROM media m WHERE m.id = ?`).get(id) as
    | MediaRow
    | undefined;
  if (!row) return null;
  return decorate([row], lang)[0];
}

/** Alimente le curseur de dates latéral : un point par mois. */
export function histogram(filters: Filters): HistogramBucket[] {
  const { sql, params, joins } = buildWhere(filters);
  const rows = db
    .prepare(
      `SELECT strftime('%Y-%m', m.taken_at / 1000, 'unixepoch', 'localtime') AS ym,
              COUNT(*) AS n
       FROM media m${joins}
       WHERE ${sql}
       GROUP BY ym
       ORDER BY ym DESC`,
    )
    .all(...params) as Array<{ ym: string; n: number }>;

  return rows
    .filter((r) => r.ym)
    .map((r) => {
      const [y, mo] = r.ym.split('-').map(Number);
      return { month: new Date(y, mo - 1, 1).getTime(), count: r.n };
    });
}

export function distinctPlaces(lang: Lang): Array<{ city: string; label: string; count: number }> {
  const rows = db
    .prepare(
      `SELECT place_city AS city, place_admin AS admin, place_country AS country, COUNT(*) AS n
       FROM media
       WHERE place_city IS NOT NULL AND missing = 0 AND hidden = 0
       GROUP BY place_city, place_admin, place_country
       ORDER BY n DESC, place_city ASC`,
    )
    .all() as Array<{ city: string; admin: string | null; country: string | null; n: number }>;
  return rows.map((r) => ({
    city: r.city,
    label: formatPlace(r.city, r.admin, r.country, lang) ?? r.city,
    count: r.n,
  }));
}

export function dateBounds(): { min: number | null; max: number | null } {
  const row = db
    .prepare(`SELECT MIN(taken_at) AS mn, MAX(taken_at) AS mx FROM media WHERE missing = 0 AND hidden = 0`)
    .get() as { mn: number | null; mx: number | null };
  return { min: row.mn, max: row.mx };
}

/** Le fond de la « vue alpha » : une photo au hasard parmi les favoris. */
export function randomFavorite(): number | null {
  const row = db
    .prepare(
      `SELECT m.id FROM album_media am
       JOIN media m ON m.id = am.media_id
       WHERE am.album_id = ? AND m.missing = 0 AND m.hidden = 0
         AND m.kind = 'photo' AND m.thumb_state = 'ready'
       ORDER BY RANDOM() LIMIT 1`,
    )
    .get(FAVORITES_ID) as { id: number } | undefined;
  return row?.id ?? null;
}
