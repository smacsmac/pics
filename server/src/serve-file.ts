import fs from 'node:fs';
import path from 'node:path';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Envoi d'un fichier du disque, et nommage d'un téléchargement.
 *
 * Extrait de `routes.ts` quand le partage d'album est arrivé : un invité
 * télécharge et regarde des vidéos exactement comme la famille, et dupliquer la
 * gestion des requêtes Range dans un second fichier aurait fini par donner deux
 * comportements différents — le genre d'écart qui ne se voit qu'une fois qu'une
 * vidéo refuse d'avancer chez une personne et pas chez l'autre.
 */

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jpe': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.tif': 'image/tiff',
  '.tiff': 'image/tiff', '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/x-m4v', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg', '.3gp': 'video/3gpp', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
};

/**
 * En-tête `content-disposition` pour un nom de fichier quelconque. Les accents
 * (« Été 2019.jpg ») ne passent pas en ASCII : on donne une version dépouillée
 * pour les vieux navigateurs, et le vrai nom encodé en UTF-8 à côté.
 */
export function attachment(filename: string): string {
  const plain = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Envoie un fichier avec support des requêtes Range (indispensable pour les vidéos). */
export async function sendFile(
  req: FastifyRequest,
  reply: FastifyReply,
  file: string,
): Promise<void> {
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
