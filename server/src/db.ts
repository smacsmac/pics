import Database from 'better-sqlite3';
import { DB_PATH, ensureDirs } from './paths.js';

ensureDirs();

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS roots (
  id      INTEGER PRIMARY KEY,
  path    TEXT NOT NULL,
  kind    TEXT NOT NULL DEFAULT 'photos',
  UNIQUE(path, kind)
);

CREATE TABLE IF NOT EXISTS media (
  id            INTEGER PRIMARY KEY,
  path          TEXT NOT NULL UNIQUE,
  root_id       INTEGER REFERENCES roots(id) ON DELETE SET NULL,
  filename      TEXT NOT NULL,
  kind          TEXT NOT NULL,
  ext           TEXT NOT NULL,
  bytes         INTEGER NOT NULL DEFAULT 0,
  mtime         INTEGER NOT NULL DEFAULT 0,
  taken_at      INTEGER NOT NULL,
  taken_source  TEXT NOT NULL DEFAULT 'mtime',
  width         INTEGER,
  height        INTEGER,
  duration      REAL,
  lat           REAL,
  lon           REAL,
  place_city    TEXT,
  place_admin   TEXT,
  place_country TEXT,
  camera        TEXT,
  hidden        INTEGER NOT NULL DEFAULT 0,
  thumb_state   TEXT NOT NULL DEFAULT 'pending',
  missing       INTEGER NOT NULL DEFAULT 0,
  added_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_taken   ON media(taken_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_media_visible ON media(hidden, missing, taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_kind    ON media(kind);
CREATE INDEX IF NOT EXISTS idx_media_thumb   ON media(thumb_state);

CREATE TABLE IF NOT EXISTS albums (
  id             INTEGER PRIMARY KEY,
  name           TEXT NOT NULL,
  color          INTEGER NOT NULL DEFAULT 285,
  music_slot     INTEGER,
  cover_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL DEFAULT 'user',
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS album_media (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (album_id, media_id)
);
CREATE INDEX IF NOT EXISTS idx_album_media_media ON album_media(media_id);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS media_tags (
  media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (media_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_media_tags_tag ON media_tags(tag_id);

CREATE TABLE IF NOT EXISTS album_tags (
  album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (album_id, tag_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Registre des fichiers déjà reçus. Il n'est jamais purgé : c'est ce qui
-- empêche une photo supprimée sur le PC de remonter depuis le téléphone.
CREATE TABLE IF NOT EXISTS imported (
  hash        TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  bytes       INTEGER NOT NULL,
  stored_at   TEXT,
  imported_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_imported_name ON imported(filename, bytes);
`);

/**
 * Ajoute une colonne à une base déjà existante. SQLite n'a pas d'`ADD COLUMN
 * IF NOT EXISTS`, et une bibliothèque déjà remplie ne doit pas être recréée.
 */
function addColumnIfMissing(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// Volume de la musique d'album pendant la lecture d'une vidéo, en pourcentage
// du volume global. 20 % laisse la musique présente sans couvrir la vidéo.
addColumnIfMissing('albums', 'video_music_pct', 'INTEGER NOT NULL DEFAULT 20');

// Arrière-plan de l'album : nom de fichier dans le dossier d'images
// d'interface, et son opacité en pourcentage.
addColumnIfMissing('albums', 'background', 'TEXT');
addColumnIfMissing('albums', 'background_opacity', 'INTEGER NOT NULL DEFAULT 35');

// Codecs d'une vidéo. NULL = jamais analysée : on le fera à la première
// lecture, pour ne pas obliger à rescanner toute une bibliothèque existante.
addColumnIfMissing('media', 'vcodec', 'TEXT');
addColumnIfMissing('media', 'acodec', 'TEXT');

// Teinte d'un tag, 0-359. NULL = pas de couleur choisie : le tag prend
// l'apparence neutre, comme avant.
addColumnIfMissing('tags', 'color', 'INTEGER');

// Album épinglé : il passe devant tous les autres, quel que soit le tri.
addColumnIfMissing('albums', 'pinned', 'INTEGER NOT NULL DEFAULT 0');

// Rotation choisie à la main, en degrés (0, 90, 180, 270). Elle s'applique aux
// vignettes et à l'affichage ; le fichier d'origine n'est jamais réécrit.
addColumnIfMissing('media', 'rotation', 'INTEGER NOT NULL DEFAULT 0');

// Signature visuelle : de quoi comparer deux photos sans les regarder. La
// grille 8×8 et l'empreinte servent aux ressemblances et aux quasi-doublons,
// les quatre mesures aux recherches par ambiance. Une bibliothèque déjà
// indexée les calcule à son prochain scan, sans refaire les vignettes.
addColumnIfMissing('media', 'sig_state', "TEXT NOT NULL DEFAULT 'pending'");
addColumnIfMissing('media', 'sig_grid', 'BLOB');
addColumnIfMissing('media', 'sig_phash', 'BLOB');
addColumnIfMissing('media', 'sig_light', 'REAL');
addColumnIfMissing('media', 'sig_sat', 'REAL');
addColumnIfMissing('media', 'sig_colorful', 'REAL');
addColumnIfMissing('media', 'sig_hue', 'INTEGER');
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_sig ON media(sig_state)`);

/** L'album « favoris » est un album normal, simplement épinglé et non supprimable. */
export function ensureFavoritesAlbum(): number {
  const existing = db.prepare(`SELECT id FROM albums WHERE kind = 'favorites'`).get() as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const now = Date.now();
  const info = db
    .prepare(
      `INSERT INTO albums (name, color, kind, created_at, updated_at)
       VALUES ('Favorites', 340, 'favorites', ?, ?)`,
    )
    .run(now, now);
  return Number(info.lastInsertRowid);
}

export const FAVORITES_ID = ensureFavoritesAlbum();

export function getSetting<T>(key: string, fallback: T): T {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, JSON.stringify(value));
}

export function tagId(name: string): number {
  const clean = name.trim();
  db.prepare(`INSERT OR IGNORE INTO tags (name) VALUES (?)`).run(clean);
  const row = db.prepare(`SELECT id FROM tags WHERE name = ?`).get(clean) as { id: number };
  return row.id;
}

/**
 * Un tag qui n'est plus attaché à rien n'a pas à traîner dans la liste des
 * filtres. Sauf s'il a reçu une couleur : c'est un choix délibéré, et le perdre
 * en retirant le tag de sa dernière photo effacerait ce réglage en silence.
 * Remettre la couleur à « aucune » le rend de nouveau effaçable.
 */
export function pruneOrphanTags(): void {
  db.exec(`
    DELETE FROM tags
    WHERE color IS NULL
      AND id NOT IN (SELECT tag_id FROM media_tags)
      AND id NOT IN (SELECT tag_id FROM album_tags)
  `);
}
