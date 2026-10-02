import type { MediaItem, PlaybackInfo, SharedAlbum } from '../../../shared/types';
import { ApiError } from './api';

/**
 * Le petit bout d'API qu'un invité peut atteindre.
 *
 * Tenu à part de `api.ts` à dessein : tout ce qui est ici est joignable depuis
 * Internet, et ce fichier doit rester assez court pour qu'on le relise d'un œil.
 * Chaque adresse porte le jeton, parce que le serveur revérifie à chaque appel
 * que la photo demandée appartient bien à l'album partagé.
 */

/** Le jeton dans l'adresse, ou null si on n'est pas sur une page de partage. */
export function tokenFromPath(pathname = window.location.pathname): string | null {
  const match = /^\/p\/([0-9a-f]{64})\/?$/.exec(pathname);
  return match ? match[1] : null;
}

async function ask<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init?.headers } : init?.headers,
  });
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = body.error;
    } catch {
      /* réponse sans corps JSON */
    }
    throw new ApiError(code, res.status);
  }
  return (await res.json()) as T;
}

export function shareApi(token: string) {
  const base = `/api/share/${token}`;
  return {
    info: () => ask<SharedAlbum>(base),
    open: (password: string) =>
      ask<{ open: boolean }>(`${base}/open`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      }),
    media: () => ask<MediaItem[]>(`${base}/media`),
    playback: (id: number) => ask<PlaybackInfo>(`${base}/playback/${id}`),

    thumbUrl: (id: number, size = 480) => `${base}/thumb/${id}?s=${size}`,
    fileUrl: (id: number) => `${base}/file/${id}`,
    proxyUrl: (id: number) => `${base}/proxy/${id}`,

    /**
     * Sans identifiants, le serveur envoie l'album entier. On laisse le
     * navigateur suivre le lien : c'est lui qui sait écrire un gros fichier sur
     * le disque, et une requête `fetch` devrait d'abord tout tenir en mémoire.
     */
    downloadUrl: (ids?: number[]) =>
      ids && ids.length > 0 ? `${base}/download?ids=${ids.join(',')}` : `${base}/download`,
  };
}

export type ShareApi = ReturnType<typeof shareApi>;
