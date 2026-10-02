import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';
import { visitorKey } from './origin.js';

export const SHARE_COOKIE = 'photon_share';

/**
 * Liens de partage d'album.
 *
 * Un lien donne accès à un seul album, en lecture seule. Il peut demander un
 * mot de passe, expirer à une date, et interdire le téléchargement. On le
 * révoque quand on veut.
 *
 * Le jeton fait 32 octets tirés au hasard. C'est lui qui protège l'album quand
 * il n'y a pas de mot de passe : 256 bits ne se devinent pas, et il ne voyage
 * que dans l'URL que vous envoyez vous-même.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS shares (
  token          TEXT PRIMARY KEY,
  album_id       INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  label          TEXT NOT NULL DEFAULT '',
  salt           TEXT,
  hash           TEXT,
  expires_at     INTEGER,
  allow_download INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  last_seen      INTEGER,
  visits         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_shares_album ON shares(album_id);
`);

export interface ShareRow {
  token: string;
  albumId: number;
  label: string;
  hasPassword: boolean;
  expiresAt: number | null;
  allowDownload: boolean;
  createdAt: number;
  lastSeen: number | null;
  visits: number;
}

interface Raw {
  token: string;
  album_id: number;
  label: string;
  salt: string | null;
  hash: string | null;
  expires_at: number | null;
  allow_download: number;
  created_at: number;
  last_seen: number | null;
  visits: number;
}

function shape(row: Raw): ShareRow {
  return {
    token: row.token,
    albumId: row.album_id,
    label: row.label,
    hasPassword: row.salt !== null && row.hash !== null,
    expiresAt: row.expires_at,
    allowDownload: row.allow_download === 1,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    visits: row.visits,
  };
}

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function createShare(opts: {
  albumId: number;
  label?: string;
  password?: string;
  /** Durée de vie en jours. 0 ou absent = sans fin. */
  days?: number;
  allowDownload?: boolean;
}): ShareRow {
  const token = crypto.randomBytes(32).toString('hex');
  const salt = opts.password ? crypto.randomBytes(16).toString('hex') : null;
  const hash = opts.password && salt ? hashPassword(opts.password, salt) : null;
  const days = Number(opts.days ?? 0);
  const expiresAt = days > 0 ? Date.now() + days * 24 * 60 * 60 * 1000 : null;

  db.prepare(
    `INSERT INTO shares (token, album_id, label, salt, hash, expires_at, allow_download, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    token,
    opts.albumId,
    (opts.label ?? '').trim().slice(0, 80),
    salt,
    hash,
    expiresAt,
    opts.allowDownload === false ? 0 : 1,
    Date.now(),
  );

  return shape(db.prepare(`SELECT * FROM shares WHERE token = ?`).get(token) as Raw);
}

export function listShares(albumId?: number): ShareRow[] {
  const rows = (albumId === undefined
    ? db.prepare(`SELECT * FROM shares ORDER BY created_at DESC`).all()
    : db.prepare(`SELECT * FROM shares WHERE album_id = ? ORDER BY created_at DESC`).all(albumId)
  ) as Raw[];
  return rows.map(shape);
}

export function revokeShare(token: string): boolean {
  // Les sessions déjà ouvertes tombent avec le lien : révoquer doit couper
  // l'accès tout de suite, pas à la prochaine visite.
  for (const [cookie, session] of guests) {
    if (session.token === token) guests.delete(cookie);
  }
  return db.prepare(`DELETE FROM shares WHERE token = ?`).run(token).changes > 0;
}

/** Nettoie les liens expirés depuis plus d'un mois, pour que la liste reste lisible. */
export function pruneShares(): number {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return db
    .prepare(`DELETE FROM shares WHERE expires_at IS NOT NULL AND expires_at < ?`)
    .run(cutoff).changes;
}

function rawByToken(token: string): Raw | undefined {
  if (!/^[0-9a-f]{64}$/.test(token)) return undefined;
  return db.prepare(`SELECT * FROM shares WHERE token = ?`).get(token) as Raw | undefined;
}

export function shareByToken(token: string): ShareRow | null {
  const row = rawByToken(token);
  if (!row) return null;
  if (row.expires_at !== null && row.expires_at < Date.now()) return null;
  return shape(row);
}

// ------------------------------------------------------- sessions d'invité

interface Guest {
  token: string;
  expiresAt: number;
}

/**
 * En mémoire, pas en base : un redémarrage du serveur redemande le mot de passe.
 * C'est volontaire — une session d'invité n'a pas à survivre à l'arrêt du PC, et
 * garder ces jetons sur disque serait du risque pour aucun confort.
 */
const guests = new Map<string, Guest>();
const GUEST_MS = 12 * 60 * 60 * 1000;

export function openShare(token: string, reply: FastifyReply): void {
  const cookie = crypto.randomBytes(32).toString('hex');
  guests.set(cookie, { token, expiresAt: Date.now() + GUEST_MS });
  void reply.setCookie(SHARE_COOKIE, cookie, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: Math.floor(GUEST_MS / 1000),
  });
}

/** Le lien que cette session d'invité a ouvert, s'il est toujours valable. */
function guestToken(req: FastifyRequest): string | null {
  const cookie = req.cookies?.[SHARE_COOKIE];
  if (!cookie) return null;
  const session = guests.get(cookie);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    guests.delete(cookie);
    return null;
  }
  return session.token;
}

/**
 * Le visiteur a-t-il le droit de voir ce lien-ci ?
 *
 * Un lien sans mot de passe s'ouvre directement. Un lien protégé exige une
 * session obtenue en donnant le mot de passe — et la session est liée à ce
 * jeton précis, pour qu'un lien ouvert n'en déverrouille pas un autre.
 */
export function shareAllowed(req: FastifyRequest, share: ShareRow): boolean {
  if (!share.hasPassword) return true;
  return guestToken(req) === share.token;
}

export function verifySharePassword(token: string, password: string): boolean {
  const row = rawByToken(token);
  if (!row || row.salt === null || row.hash === null) return false;
  const candidate = Buffer.from(hashPassword(password, row.salt), 'hex');
  const expected = Buffer.from(row.hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function noteVisit(token: string): void {
  db.prepare(`UPDATE shares SET visits = visits + 1, last_seen = ? WHERE token = ?`)
    .run(Date.now(), token);
}

// ------------------------------------------------- limite d'essais de mot de passe

/**
 * Un lien protégé est joignable depuis Internet : sans frein, on teste des
 * milliers de mots de passe par minute. Dix essais par quart d'heure et par
 * visiteur suffisent à quelqu'un qui tape mal, et rendent la devinette vaine.
 */
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_MAX = 10;
const attempts = new Map<string, number[]>();

export function tooManyAttempts(req: FastifyRequest): boolean {
  const key = visitorKey(req);
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  attempts.set(key, recent);
  return recent.length >= ATTEMPT_MAX;
}

export function noteAttempt(req: FastifyRequest): void {
  const key = visitorKey(req);
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < ATTEMPT_WINDOW_MS);
  recent.push(now);
  attempts.set(key, recent);

  // La carte ne doit pas grossir indéfiniment sur un serveur laissé allumé.
  if (attempts.size > 4096) {
    for (const [k, times] of attempts) {
      if (times.every((t) => now - t >= ATTEMPT_WINDOW_MS)) attempts.delete(k);
    }
  }
}

export function clearAttempts(req: FastifyRequest): void {
  attempts.delete(visitorKey(req));
}

// --------------------------------------------------------- portée d'un lien

/**
 * Cette photo fait-elle partie de l'album partagé ?
 *
 * C'est la vérification qui compte le plus de tout le partage. Chaque route
 * d'invité passe par ici avant de servir quoi que ce soit : sans elle, il
 * suffirait de changer le numéro dans l'URL d'une vignette pour parcourir toute
 * la bibliothèque, un identifiant à la fois.
 *
 * Les photos masquées sont exclues. « Masquer » veut dire « hors des vues », et
 * un invité est encore moins concerné que la famille.
 */
export function mediaInShare(share: ShareRow, id: number): boolean {
  if (!Number.isFinite(id)) return false;
  const row = db
    .prepare(
      `SELECT 1 FROM album_media am
         JOIN media m ON m.id = am.media_id
        WHERE am.album_id = ? AND am.media_id = ? AND m.hidden = 0 AND m.missing = 0`,
    )
    .get(share.albumId, id);
  return row !== undefined;
}

/** Les identifiants de l'album partagé, dans l'ordre d'affichage. */
export function shareMediaIds(share: ShareRow): number[] {
  const rows = db
    .prepare(
      `SELECT m.id FROM album_media am
         JOIN media m ON m.id = am.media_id
        WHERE am.album_id = ? AND m.hidden = 0 AND m.missing = 0
        ORDER BY m.taken_at DESC, m.id DESC`,
    )
    .all(share.albumId) as Array<{ id: number }>;
  return rows.map((r) => r.id);
}
