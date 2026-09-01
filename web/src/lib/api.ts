import type {
  Album, AppState, Chapter, DuplicateGroup, HistogramBucket, MediaItem, MediaPage, MediaQuery,
  OnThisDay, PlaybackInfo, Root, Settings, UploadResult,
} from '../../../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
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

export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}

function queryString(q: MediaQuery): string {
  const params = new URLSearchParams();
  if (q.from !== undefined) params.set('from', String(q.from));
  if (q.to !== undefined) params.set('to', String(q.to));
  if (q.tags && q.tags.length) params.set('tags', q.tags.join(','));
  if (q.place) params.set('place', q.place);
  if (q.album !== undefined) params.set('album', String(q.album));
  if (q.kind) params.set('kind', q.kind);
  if (q.mood) params.set('mood', q.mood);
  if (q.similar !== undefined) params.set('similar', String(q.similar));
  if (q.showHidden) params.set('showHidden', '1');
  if (q.cursor) params.set('cursor', q.cursor);
  if (q.limit) params.set('limit', String(q.limit));
  return params.toString();
}

export const api = {
  state: () => request<AppState>('/api/state'),

  media: (q: MediaQuery) => request<MediaPage>(`/api/media?${queryString(q)}`),
  histogram: (q: MediaQuery) => request<HistogramBucket[]>(`/api/media/histogram?${queryString(q)}`),
  mediaItem: (id: number) => request<MediaItem>(`/api/media/${id}`),
  randomFavorite: () => request<{ id: number | null }>('/api/media/random-favorite'),

  hide: (ids: number[], hidden: boolean) =>
    request<{ changed: number }>('/api/media/hide', {
      method: 'POST',
      body: JSON.stringify({ ids, hidden }),
    }),

  tagMedia: (ids: number[], add: string[], remove: string[]) =>
    request<{ changed: number }>('/api/media/tags', {
      method: 'POST',
      body: JSON.stringify({ ids, add, remove }),
    }),

  albums: () => request<Album[]>('/api/albums'),

  createAlbum: (body: {
    name: string; color: number; musicSlot: number | null; videoMusicPct: number;
    background: string | null; backgroundOpacity: number; tags: string[];
  }) => request<Album>('/api/albums', { method: 'POST', body: JSON.stringify(body) }),

  updateAlbum: (
    id: number,
    body: Partial<{
      name: string; color: number; musicSlot: number | null; videoMusicPct: number;
      background: string | null; backgroundOpacity: number;
      coverMediaId: number | null; tags: string[]; pinned: boolean;
    }>,
  ) => request<Album>(`/api/albums/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  backgroundUrl: (name: string) => `/api/background?name=${encodeURIComponent(name)}`,

  /** Demande au serveur lesquels de ces fichiers il connaît déjà. */
  uploadCheck: (files: Array<{ name: string; size: number }>) =>
    request<{ known: boolean[]; ready: boolean }>('/api/upload/check', {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),

  drainInbox: () =>
    request<{ results: UploadResult[] }>('/api/inbox/drain', { method: 'POST' }),

  /**
   * Envoie un fichier. On passe par XMLHttpRequest et non fetch : c'est le seul
   * moyen d'obtenir la progression de l'envoi, indispensable quand on transfère
   * cinquante photos depuis un téléphone.
   */
  uploadFile(
    file: File,
    onProgress: (ratio: number) => void,
    signal?: AbortSignal,
  ): Promise<UploadResult> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file, file.name);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/upload?mtime=${file.lastModified || Date.now()}`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(e.loaded / e.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText) as { results: UploadResult[] };
            resolve(body.results[0] ?? { name: file.name, outcome: 'rejected' });
          } catch {
            reject(new ApiError('bad_response', xhr.status));
          }
        } else {
          let code = `http_${xhr.status}`;
          try {
            code = (JSON.parse(xhr.responseText) as { error?: string }).error ?? code;
          } catch {
            /* corps non JSON */
          }
          reject(new ApiError(code, xhr.status));
        }
      };
      xhr.onerror = () => reject(new ApiError('network', 0));
      xhr.onabort = () => reject(new ApiError('aborted', 0));
      signal?.addEventListener('abort', () => xhr.abort(), { once: true });
      xhr.send(form);
    });
  },

  deleteAlbum: (id: number) => request<{ deleted: number }>(`/api/albums/${id}`, { method: 'DELETE' }),

  albumMedia: (albumId: number, ids: number[], remove = false) =>
    request<{ changed: number; albums: Album[] }>(`/api/albums/${albumId}/media`, {
      method: 'POST',
      body: JSON.stringify({ ids, remove }),
    }),

  tags: () => request<Array<{ name: string; count: number }>>('/api/tags'),
  places: () => request<Array<{ city: string; label: string; count: number }>>('/api/places'),

  saveSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),

  login: (password: string) =>
    request<{ ok: true }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>('/api/admin/logout', { method: 'POST' }),
  setChildMode: (on: boolean) =>
    request<{ childMode: boolean }>('/api/admin/child-mode', {
      method: 'POST',
      body: JSON.stringify({ on }),
    }),
  changePassword: (next: string) =>
    request<{ ok: true }>('/api/admin/password', { method: 'POST', body: JSON.stringify({ next }) }),

  roots: () => request<Root[]>('/api/roots'),
  addRoot: (path: string, kind: Root['kind']) =>
    request<Root[]>('/api/roots', { method: 'POST', body: JSON.stringify({ path, kind }) }),
  removeRoot: (id: number) => request<Root[]>(`/api/roots/${id}`, { method: 'DELETE' }),

  scan: () => request<{ started: boolean }>('/api/scan', { method: 'POST' }),
  backfillPlaces: () =>
    request<{ updated: number }>('/api/scan/backfill-places', { method: 'POST' }),

  playback: (id: number) => request<PlaybackInfo>(`/api/media/${id}/playback`),

  /** Tags déjà portés par une sélection : sur tous, ou sur une partie. */
  tagSummary: (ids: number[]) =>
    request<{ all: string[]; some: string[] }>(`/api/media/tag-summary?ids=${ids.join(',')}`),

  rotate: (ids: number[], delta = 90) =>
    request<{ changed: number }>('/api/media/rotate', {
      method: 'POST',
      body: JSON.stringify({ ids, delta }),
    }),

  setTagColor: (name: string, color: number | null) =>
    request<{ name: string; color: number | null }>('/api/tags/color', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),

  /**
   * Les vignettes sont mises en cache « pour toujours » par le navigateur.
   * Tourner une photo en refait une nouvelle sous le même nom : l'angle entre
   * donc dans l'URL, sinon l'ancienne image resterait affichée.
   */
  thumbUrl: (id: number, size: number, rotation = 0) =>
    `/api/thumb/${id}?s=${size}${rotation ? `&r=${rotation}` : ''}`,
  fileUrl: (id: number) => `/api/file/${id}`,
  musicUrl: (slot: number) => `/api/music/${slot}`,

  // ------------------------------------------------------------- souvenirs

  chapters: (limit = 120) => request<Chapter[]>(`/api/chapters?limit=${limit}`),
  duplicates: (limit = 60) => request<DuplicateGroup[]>(`/api/duplicates?limit=${limit}`),
  onThisDay: () => request<OnThisDay[]>('/api/media/on-this-day'),
  mediaByIds: (ids: number[]) =>
    request<MediaItem[]>(`/api/media/by-ids?ids=${ids.join(',')}`),

  albumFromChapter: (name: string, ids: number[], color: number) =>
    request<{ album: Album; albums: Album[] }>('/api/albums/from-chapter', {
      method: 'POST',
      body: JSON.stringify({ name, ids, color }),
    }),

  /**
   * Enregistrer une sélection. On laisse le navigateur suivre le lien : c'est
   * lui qui affiche l'avancement et propose où ranger le fichier, ce qu'aucun
   * appel `fetch` ne saurait faire aussi bien.
   */
  downloadUrl: (ids: number[]) => `/api/media/download?ids=${ids.join(',')}`,
};
