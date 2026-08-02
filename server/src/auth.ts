import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getSetting, setSetting } from './db.js';

export const ADMIN_COOKIE = 'photon_admin';

interface Stored {
  salt: string;
  hash: string;
}

const sessions = new Map<string, number>(); // token -> expiration
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

function hash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function isPasswordSet(): boolean {
  return getSetting<Stored | null>('adminPassword', null) !== null;
}

export function setPassword(password: string): void {
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('adminPassword', { salt, hash: hash(password, salt) } satisfies Stored);
}

export function verifyPassword(password: string): boolean {
  const stored = getSetting<Stored | null>('adminPassword', null);
  if (!stored) return false;
  const candidate = Buffer.from(hash(password, stored.salt), 'hex');
  const expected = Buffer.from(stored.hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function createSession(): string {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  return token;
}

export function destroySession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function isAdmin(req: FastifyRequest): boolean {
  // Aucun mot de passe défini : l'app est en « portes ouvertes », premier
  // démarrage. On reste admin jusqu'à ce qu'un mot de passe soit choisi.
  if (!isPasswordSet()) return true;
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * L'app écoute sur le réseau local : cacher un bouton côté interface ne protège
 * rien. Toute opération sensible repasse par ici, côté serveur.
 */
export function requireAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isAdmin(req)) return true;
  void reply.code(403).send({ error: 'admin_required' });
  return false;
}
