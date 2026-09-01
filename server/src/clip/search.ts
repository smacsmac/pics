/**
 * Rangement et recherche des vecteurs CLIP.
 *
 * Chaque photo indexée porte 512 nombres décrivant ce qu'on y voit. Une phrase
 * donne 512 nombres du même genre, et la ressemblance entre les deux est un
 * simple produit scalaire — les vecteurs étant de longueur 1, il vaut le cosinus
 * de l'angle qui les sépare.
 *
 * Dix mille photos font vingt mégaoctets et cinq millions de multiplications
 * par recherche, soit quelques millisecondes : aucun index n'est nécessaire.
 */
import { db } from '../db.js';
import { EMBED_DIM } from './model.js';

/** Combien de photos une recherche rapporte au plus. */
export const SEARCH_LIMIT = 60;

/** Un vecteur devient 2 048 octets ; SQLite les rend tels quels. */
export function packEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function unpackEmbedding(buf: Buffer): Float32Array {
  // On recopie : la vue de Node pointe dans un tampon partagé, que SQLite
  // réutilise d'une ligne à l'autre.
  const out = new Float32Array(EMBED_DIM);
  for (let i = 0; i < EMBED_DIM; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

/** Produit scalaire de deux vecteurs de longueur 1 : leur ressemblance. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function saveEmbedding(id: number, vec: Float32Array | null): void {
  if (vec === null || vec.length !== EMBED_DIM) {
    db.prepare(`UPDATE media SET clip_state = 'failed' WHERE id = ?`).run(id);
    return;
  }
  db.prepare(`UPDATE media SET clip_state = 'ready', clip = ? WHERE id = ?`)
    .run(packEmbedding(vec), id);
}

export interface Scored {
  id: number;
  score: number;
}

/**
 * Classe toutes les photos indexées face à un vecteur de recherche, de la plus
 * proche à la plus lointaine.
 *
 * Aucun seuil absolu n'est appliqué. Les similarités de CLIP entre une image et
 * un texte tournent autour de 0,2 à 0,3 même pour une correspondance parfaite —
 * les deux familles de vecteurs ne se mélangent pas complètement. Un seuil
 * choisi au jugé écarterait donc de bonnes réponses ; on rend les meilleures, et
 * l'interface annonce qu'il s'agit des meilleures.
 */
export function rank(query: Float32Array, limit = SEARCH_LIMIT, includeHidden = false): Scored[] {
  const rows = db
    .prepare(
      `SELECT id, clip FROM media
        WHERE clip_state = 'ready' AND missing = 0 AND clip IS NOT NULL
          ${includeHidden ? '' : 'AND hidden = 0'}`,
    )
    .all() as Array<{ id: number; clip: Buffer }>;

  const scored: Scored[] = [];
  for (const row of rows) {
    if (row.clip.length !== EMBED_DIM * 4) continue;
    scored.push({ id: row.id, score: dot(query, unpackEmbedding(row.clip)) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, limit));
}

/** Combien de photos sont indexées, et combien restent à faire. */
export function progress(): { done: number; total: number } {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN clip_state = 'ready' THEN 1 ELSE 0 END) AS done,
         COUNT(*) AS total
       FROM media WHERE missing = 0 AND kind = 'photo'`,
    )
    .get() as { done: number | null; total: number };
  return { done: row.done ?? 0, total: row.total };
}
