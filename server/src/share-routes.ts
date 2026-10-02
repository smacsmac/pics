import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { MediaItem, SharedAlbum } from '../../shared/types.js';
import { db } from './db.js';
import { getMediaByIds } from './media-query.js';
import { thumbPath } from './paths.js';
import { attachment, sendFile } from './serve-file.js';
import { nearestThumbSize } from './thumbs.js';
import { getSettings } from './settings.js';
import {
  clearAttempts, mediaInShare, noteAttempt, noteVisit, openShare, shareAllowed, shareByToken,
  shareMediaIds, tooManyAttempts, verifySharePassword, type ShareRow,
} from './share.js';
import { playbackInfo, proxyFile } from './transcode.js';
import { zipStream } from './zip.js';

/** Plafond d'un téléchargement groupé par un invité, comme pour la famille. */
const DOWNLOAD_MAX = 2000;

/**
 * Les routes qu'un visiteur distant peut atteindre. Toutes les autres lui sont
 * refusées par le garde de `index.ts`, avant même d'arriver ici.
 *
 * Deux règles tiennent toute la sécurité de ce fichier, et chaque route les
 * applique dans cet ordre :
 *
 *   1. le lien existe-t-il, est-il encore valable, et le visiteur a-t-il donné
 *      le mot de passe s'il en faut un ?
 *   2. la photo demandée appartient-elle bien à *cet* album ?
 *
 * La seconde est la plus facile à oublier et la plus coûteuse à manquer : sans
 * elle, changer le numéro dans l'URL d'une vignette suffirait à parcourir toute
 * la bibliothèque, un identifiant à la fois. Aucune route ne sert un octet
 * venant du disque sans être passée par `mediaInShare`.
 */
export function registerShareRoutes(app: FastifyInstance): void {
  /**
   * Résout le lien et vérifie le droit d'entrée. Rend `null` après avoir
   * répondu, pour que l'appelant n'ait qu'à sortir.
   *
   * Un jeton inconnu, expiré ou révoqué donne 404 et non 403 : ne pas confirmer
   * qu'un lien a existé évite de renseigner qui essaie des jetons au hasard.
   */
  const resolve = (req: FastifyRequest, reply: FastifyReply): ShareRow | null => {
    const token = String((req.params as { token?: string }).token ?? '');
    const share = shareByToken(token);
    if (!share) {
      void reply.code(404).send({ error: 'not_found' });
      return null;
    }
    if (!shareAllowed(req, share)) {
      void reply.code(401).send({ error: 'password_required' });
      return null;
    }
    return share;
  };

  /**
   * Ce qu'il y a derrière le lien. Avant le mot de passe on ne dit rien de
   * l'album — pas même son nom : le lien a pu être transmis à quelqu'un d'autre,
   * et « Anniversaire de Léa » en dit déjà trop.
   */
  app.get('/api/share/:token', async (req, reply) => {
    const token = String((req.params as { token: string }).token);
    const share = shareByToken(token);
    if (!share) return reply.code(404).send({ error: 'not_found' });

    if (!shareAllowed(req, share)) {
      return { needsPassword: true, open: false } satisfies Partial<SharedAlbum>;
    }

    const album = db.prepare(`SELECT name, color FROM albums WHERE id = ?`).get(share.albumId) as
      | { name: string; color: number }
      | undefined;
    if (!album) return reply.code(404).send({ error: 'not_found' });

    noteVisit(token);
    return {
      needsPassword: share.hasPassword,
      open: true,
      name: album.name,
      color: album.color,
      count: shareMediaIds(share).length,
      allowDownload: share.allowDownload,
      expiresAt: share.expiresAt,
      lang: getSettings().lang,
    } satisfies SharedAlbum;
  });

  app.post('/api/share/:token/open', async (req, reply) => {
    const token = String((req.params as { token: string }).token);

    // Le frein avant la vérification : sinon compter les essais ne sert à rien.
    if (tooManyAttempts(req)) {
      return reply.code(429).send({ error: 'too_many_attempts' });
    }

    const share = shareByToken(token);
    const password = String((req.body as { password?: string })?.password ?? '');

    // Un jeton inconnu passe aussi par le compteur : sans cela, on pourrait
    // sonder des jetons au hasard sans jamais être freiné.
    if (!share || !share.hasPassword || !verifySharePassword(token, password)) {
      noteAttempt(req);
      return reply.code(share && share.hasPassword ? 401 : 404).send({ error: 'refused' });
    }

    clearAttempts(req);
    openShare(token, reply);
    return { open: true };
  });

  app.get('/api/share/:token/media', async (req, reply) => {
    const share = resolve(req, reply);
    if (!share) return reply;

    const items = getMediaByIds(shareMediaIds(share), getSettings().lang);
    // On retire ce qui ne regarde pas l'invité : les favoris de la maison, et
    // les tags hérités — qui peuvent venir d'un *autre* album que celui partagé.
    return items.map((item) => stripForGuest(item));
  });

  app.get('/api/share/:token/thumb/:id', async (req, reply) => {
    const share = resolve(req, reply);
    if (!share) return reply;

    const id = Number((req.params as { id: string }).id);
    if (!mediaInShare(share, id)) return reply.code(404).send({ error: 'not_found' });

    const size = nearestThumbSize(Number((req.query as { s?: string }).s) || 480);
    const file = thumbPath(id, size);
    void reply.header('cache-control', 'private, max-age=3600');
    return sendFile(req, reply, file);
  });

  app.get('/api/share/:token/file/:id', async (req, reply) => {
    const share = resolve(req, reply);
    if (!share) return reply;

    const id = Number((req.params as { id: string }).id);
    if (!mediaInShare(share, id)) return reply.code(404).send({ error: 'not_found' });

    const row = db.prepare(`SELECT path FROM media WHERE id = ?`).get(id) as
      | { path: string }
      | undefined;
    if (!row) return reply.code(404).send({ error: 'not_found' });
    return sendFile(req, reply, row.path);
  });

  /**
   * Comment lire cette vidéo : le fichier d'origine, ou une copie H.264.
   *
   * L'adresse rendue est réécrite pour l'invité. `playbackInfo` donne celle de
   * la famille (`/api/file/...`), que le garde par origine refuse — la balise
   * vidéo n'afficherait qu'un rectangle noir sans explication.
   */
  app.get('/api/share/:token/playback/:id', async (req, reply) => {
    const share = resolve(req, reply);
    if (!share) return reply;

    const id = Number((req.params as { id: string }).id);
    if (!mediaInShare(share, id)) return reply.code(404).send({ error: 'not_found' });

    const info = await playbackInfo(id);
    if (!info) return reply.code(404).send({ error: 'not_found' });

    const base = `/api/share/${share.token}`;
    return {
      ...info,
      url:
        info.url === null ? null
        : info.direct ? `${base}/file/${id}`
        : `${base}/proxy/${id}`,
    };
  });

  app.get('/api/share/:token/proxy/:id', async (req, reply) => {
    const share = resolve(req, reply);
    if (!share) return reply;

    const id = Number((req.params as { id: string }).id);
    if (!mediaInShare(share, id)) return reply.code(404).send({ error: 'not_found' });

    const file = proxyFile(id);
    if (!file) return reply.code(404).send({ error: 'not_ready' });
    return sendFile(req, reply, file);
  });

  /**
   * Emporter une copie. C'est le but du partage : la personne repart avec les
   * fichiers chez elle. Rien n'est déplacé ni modifié ici — on lit, on envoie.
   */
  app.get('/api/share/:token/download', async (req, reply) => {
    const share = resolve(req, reply);
    if (!share) return reply;
    if (!share.allowDownload) return reply.code(403).send({ error: 'download_disabled' });

    /**
     * Les identifiants demandés, s'il y en a.
     *
     * Les morceaux vides sont écartés *avant* la conversion, et c'est tout le
     * sujet : `''.split(',')` rend `['']`, et `Number('')` vaut 0, pas `NaN`.
     * Sans ce filtre, une requête sans paramètre demandait la photo n° 0 — qui
     * n'existe pas — et « tout enregistrer », le geste le plus courant d'un
     * invité, répondait « introuvable ».
     */
    const asked = String((req.query as { ids?: string }).ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== '')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, DOWNLOAD_MAX);

    // Rien de demandé = tout l'album. C'est le geste le plus courant.
    const ids = asked.length > 0 ? asked.filter((id) => mediaInShare(share, id)) : shareMediaIds(share);
    if (ids.length === 0) return reply.code(404).send({ error: 'not_found' });

    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT id, path, filename, mtime FROM media
          WHERE id IN (${placeholders}) AND missing = 0`,
      )
      .all(...ids) as Array<{ id: number; path: string; filename: string; mtime: number }>;

    const byId = new Map(rows.map((r) => [r.id, r]));
    const picked = ids.map((id) => byId.get(id)).filter((r) => r !== undefined);
    if (picked.length === 0) return reply.code(404).send({ error: 'not_found' });

    if (picked.length === 1) {
      const only = picked[0];
      void reply.header('content-disposition', attachment(only.filename));
      return sendFile(req, reply, only.path);
    }

    const album = db.prepare(`SELECT name FROM albums WHERE id = ?`).get(share.albumId) as
      | { name: string }
      | undefined;
    const base = (album?.name ?? 'photos').replace(/[^\p{L}\p{N} ._-]/gu, '').trim() || 'photos';

    return reply
      .header('content-type', 'application/zip')
      .header('cache-control', 'no-store')
      .header('content-disposition', attachment(`${base}.zip`))
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
}

/**
 * Ce qu'un invité reçoit d'une photo. On enlève `favorite` et `albumTags` :
 * le premier est une préférence de la maison, le second peut nommer les tags
 * d'un album que l'invité n'a pas à connaître.
 */
function stripForGuest(item: MediaItem): MediaItem {
  return { ...item, favorite: false, tags: [], albumTags: [] };
}
