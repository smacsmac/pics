import type {
  Chapter, DuplicateGroup, HistogramBucket, Lang, MediaItem, MediaPage, Mood, OnThisDay,
} from '../../shared/types.js';
import { db, FAVORITES_ID } from './db.js';
import { formatPlace } from './geocode.js';
import { gridDistance, hamming, moodSql, similarity } from './vision.js';

export interface Filters {
  from?: number;
  to?: number;
  tags?: string[];
  place?: string;
  album?: number;
  kind?: 'photo' | 'video';
  includeHidden?: boolean;
  /** Ambiance visuelle : couleurs et lumière, pas le contenu de la photo. */
  mood?: Mood;
  /** Ne garder que ce qui ressemble à cette photo-ci. */
  similar?: number;
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

  if (f.mood) {
    const rule = moodSql(f.mood);
    // Une photo non signée n'a pas d'ambiance connue : mieux vaut l'écarter que
    // la faire passer pour terne.
    if (rule) where.push(`(m.sig_state = 'ready' AND ${rule})`);
  }

  if (f.similar !== undefined) {
    const ids = similarIds(f.similar);
    // Aucun résultat : une condition toujours fausse, plutôt qu'un `IN ()` que
    // SQLite refuse.
    if (ids.length === 0) where.push('0');
    else where.push(`m.id IN (${ids.join(',')})`);
  }

  return { sql: where.join(' AND '), params, joins };
}

/** Toutes les signatures en mémoire : 200 octets par photo, négligeable. */
function loadSignatures(): Array<{ id: number; grid: Buffer; phash: Buffer }> {
  return db
    .prepare(
      `SELECT id, sig_grid AS grid, sig_phash AS phash FROM media
        WHERE sig_state = 'ready' AND missing = 0 AND sig_grid IS NOT NULL`,
    )
    .all() as Array<{ id: number; grid: Buffer; phash: Buffer }>;
}

/**
 * En deçà, deux photos n'ont plus grand-chose en commun. Mesuré sur une
 * bibliothèque d'essai : les prises d'une même scène tombent au-dessus de 0,88,
 * les autres en dessous de 0,885 — la coupure est nette.
 */
const SIMILAR_MIN = 0.88;
const SIMILAR_MAX = 200;

/**
 * Les photos qui ressemblent le plus à celle donnée, elle-même comprise. On
 * compare la signature de chacune : quelques millions d'opérations pour une
 * bibliothèque de dix mille photos, soit une poignée de millisecondes —
 * inutile de bâtir un index.
 */
export function similarIds(id: number): number[] {
  const target = db
    .prepare(
      `SELECT sig_grid AS grid, sig_phash AS phash FROM media
        WHERE id = ? AND sig_state = 'ready'`,
    )
    .get(id) as { grid: Buffer; phash: Buffer } | undefined;
  if (!target || !target.grid) return [];

  const scored: Array<{ id: number; score: number }> = [];
  for (const row of loadSignatures()) {
    if (row.id === id) continue;
    const score = similarity(target, row);
    if (score >= SIMILAR_MIN) scored.push({ id: row.id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // La photo de départ reste dans le lot : on veut la voir au milieu des
  // autres pour juger de la ressemblance.
  return [id, ...scored.slice(0, SIMILAR_MAX).map((r) => r.id)];
}

/** Au-delà, ce ne sont plus deux prises du même instant mais deux photos. */
const DUP_HAMMING = 12; // sur 128 bits
const DUP_GRID = 0.1;
/** Les doublons se suivent dans le temps : inutile de comparer au-delà. */
const DUP_WINDOW = 60;
/** Une rafale tient dans quelques minutes. */
const DUP_GAP_MS = 2 * 60 * 1000;
/**
 * Signature rigoureusement identique : c'est le même fichier, et la date n'a
 * plus son mot à dire. « Presque identique » ne suffit pas — deux photos d'une
 * même série de vacances y passaient, et se retrouvaient groupées à trois ans
 * d'écart.
 */
function memeFichier(a: { grid: Buffer; phash: Buffer }, b: { grid: Buffer; phash: Buffer }): boolean {
  return hamming(a.phash, b.phash) === 0 && gridDistance(a.grid, b.grid) === 0;
}

/**
 * Les séries de photos quasi identiques : la même scène prise cinq fois, ou un
 * fichier importé deux fois sous deux noms.
 *
 * Trois conditions, chacune pour une raison :
 *
 * * l'empreinte proche, pour la composition ;
 * * la grille proche aussi — l'empreinte seule confond volontiers deux images
 *   de composition voisine mais de couleurs opposées ;
 * * le même instant, à deux minutes près. Sans cette dernière, deux photos qui
 *   se ressemblent à trois ans d'écart formaient une « rafale ». L'exception :
 *   une empreinte quasi identique, qui trahit le même fichier importé deux fois
 *   et peut porter n'importe quelle date — signature rigoureusement identique,
 *   pas seulement voisine.
 *
 * Les vidéos sont écartées : leur vignette est une image parmi des milliers, et
 * une vidéo n'est de toute façon jamais le doublon d'une photo.
 *
 * Rien n'est supprimé : Photon montre les séries, c'est vous qui triez.
 */
export function duplicateGroups(limit = 60): DuplicateGroup[] {
  const rows = db
    .prepare(
      `SELECT id, taken_at, width, height, sig_grid AS grid, sig_phash AS phash
         FROM media
        WHERE sig_state = 'ready' AND missing = 0 AND hidden = 0 AND sig_grid IS NOT NULL
          AND kind = 'photo'
        ORDER BY taken_at DESC`,
    )
    .all() as Array<{
      id: number; taken_at: number; width: number | null; height: number | null;
      grid: Buffer; phash: Buffer;
    }>;

  const seen = new Set<number>();
  const groups: DuplicateGroup[] = [];

  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (seen.has(a.id)) continue;
    const members = [a];

    // On ne compare qu'à un voisinage, ce qui évite un balayage en carré.
    for (let j = i + 1; j < Math.min(rows.length, i + DUP_WINDOW); j++) {
      const b = rows[j];
      if (seen.has(b.id)) continue;
      if (hamming(a.phash, b.phash) > DUP_HAMMING) continue;
      if (gridDistance(a.grid, b.grid) > DUP_GRID) continue;
      // Deux photos qui se ressemblent à des années d'écart ne sont pas une
      // rafale : ce sont deux photos qui se ressemblent. Sauf si l'empreinte
      // est quasi identique — là c'est le même fichier, importé deux fois.
      const memeInstant = Math.abs(a.taken_at - b.taken_at) <= DUP_GAP_MS;
      if (memeInstant || memeFichier(a, b)) members.push(b);
    }

    if (members.length < 2) continue;
    for (const m of members) seen.add(m.id);

    // « La meilleure » : la plus définie, à défaut la première du lot.
    const best = members.reduce((keep, m) =>
      (m.width ?? 0) * (m.height ?? 0) > (keep.width ?? 0) * (keep.height ?? 0) ? m : keep,
    );
    const times = members.map((m) => m.taken_at);
    groups.push({
      id: `d${members[members.length - 1].id}`,
      ids: members.map((m) => m.id),
      bestId: best.id,
      from: Math.min(...times),
      to: Math.max(...times),
    });
    if (groups.length >= limit) break;
  }

  return groups;
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
