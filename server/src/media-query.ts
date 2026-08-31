import type {
  Chapter, HistogramBucket, Lang, MediaItem, MediaPage, OnThisDay,
} from '../../shared/types.js';
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

/**
 * Récupère un lot de photos par identifiants, dans l'ordre demandé. C'est ce
 * qui permet à un diaporama de partir d'un chapitre : la liste vient déjà
 * ordonnée, et SQLite la rendrait autrement.
 */
export function getMediaByIds(ids: number[], lang: Lang): MediaItem[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT ${SELECT_COLS} FROM media m WHERE m.id IN (${placeholders}) AND m.missing = 0`)
    .all(...ids) as MediaRow[];
  const byId = new Map(decorate(rows, lang).map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is MediaItem => item !== undefined);
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

// ---------------------------------------------------------------- souvenirs

/** Un nouveau chapitre démarre après ce silence, ou en changeant de ville. */
const CHAPTER_GAP_MS = 8 * 60 * 60 * 1000;
/** En deçà, ce n'est pas un moment : deux photos prises en passant. */
const CHAPTER_MIN = 4;
/** Vignettes montrées sur la carte d'un moment. */
const PREVIEW_MAX = 5;

/**
 * Découpe la bibliothèque en « moments » : une suite de photos rapprochées dans
 * le temps et prises au même endroit. Vingt photos en un après-midi à Hamilton
 * forment une sortie ; deux photos isolées, non.
 *
 * Rien n'est stocké : le découpage se recalcule, donc il suit la bibliothèque
 * sans jamais se périmer.
 */
export function chapters(limit = 120): Chapter[] {
  const rows = db
    .prepare(
      `SELECT id, taken_at, place_city, kind, thumb_state, rotation
         FROM media
        WHERE missing = 0 AND hidden = 0
        ORDER BY taken_at DESC`,
    )
    .all() as Array<{
      id: number;
      taken_at: number;
      place_city: string | null;
      kind: string;
      thumb_state: string;
      rotation: number;
    }>;

  const out: Chapter[] = [];
  let current: typeof rows = [];

  const flush = (): void => {
    if (current.length < CHAPTER_MIN) {
      current = [];
      return;
    }
    // Les photos sont parcourues du plus récent au plus ancien.
    const last = current[0];
    const first = current[current.length - 1];
    const cover = current.find((r) => r.kind === 'photo' && r.thumb_state === 'ready') ?? current[0];
    // La bande de la carte : la couverture d'abord, puis d'autres photos prêtes
    // prises un peu partout dans le moment plutôt que toutes au même instant.
    const rest = current.filter((r) => r.id !== cover.id && r.thumb_state === 'ready');
    const stride = Math.max(1, Math.floor(rest.length / PREVIEW_MAX));
    const preview = [cover, ...rest.filter((_, i) => i % stride === 0)]
      .slice(0, PREVIEW_MAX)
      .map((r) => ({ id: r.id, rotation: r.rotation }));

    out.push({
      id: `${first.taken_at}-${last.taken_at}`,
      from: first.taken_at,
      to: last.taken_at,
      city: first.place_city,
      count: current.length,
      coverId: cover.id,
      preview,
      ids: current.map((r) => r.id).reverse(),
    });
    current = [];
  };

  for (const row of rows) {
    if (current.length > 0) {
      const previous = current[current.length - 1];
      const gap = previous.taken_at - row.taken_at;
      // Un lieu inconnu ne coupe pas : sans GPS, seul le temps décide.
      const moved =
        previous.place_city !== null && row.place_city !== null &&
        previous.place_city !== row.place_city;
      if (gap > CHAPTER_GAP_MS || moved) flush();
    }
    current.push(row);
    if (out.length >= limit) break;
  }
  flush();

  return out.slice(0, limit);
}

/** Les photos prises un même jour de l'année, les années précédentes. */
export function onThisDay(lang: Lang): OnThisDay[] {
  const now = new Date();
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const rows = db
    .prepare(
      `SELECT ${SELECT_COLS} FROM media m
        WHERE m.missing = 0 AND m.hidden = 0
          AND strftime('%m-%d', m.taken_at / 1000, 'unixepoch', 'localtime') = ?
          AND strftime('%Y', m.taken_at / 1000, 'unixepoch', 'localtime') <> ?
        ORDER BY m.taken_at DESC`,
    )
    .all(md, String(now.getFullYear())) as MediaRow[];

  const items = decorate(rows, lang);
  const byYear = new Map<number, MediaItem[]>();
  for (const item of items) {
    const year = new Date(item.takenAt).getFullYear();
    const list = byYear.get(year);
    if (list) list.push(item);
    else byYear.set(year, [item]);
  }
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([year, list]) => ({ year, items: list }));
}
