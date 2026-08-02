import type {
  Album, AppState, HistogramBucket, MediaItem, MediaPage, MediaQuery, Root, Settings,
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

  createAlbum: (body: { name: string; color: number; musicSlot: number | null; tags: string[] }) =>
    request<Album>('/api/albums', { method: 'POST', body: JSON.stringify(body) }),

  updateAlbum: (
    id: number,
    body: Partial<{
      name: string; color: number; musicSlot: number | null;
      coverMediaId: number | null; tags: string[];
    }>,
  ) => request<Album>(`/api/albums/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

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
  changePassword: (next: string) =>
    request<{ ok: true }>('/api/admin/password', { method: 'POST', body: JSON.stringify({ next }) }),

  roots: () => request<Root[]>('/api/roots'),
  addRoot: (path: string, kind: Root['kind']) =>
    request<Root[]>('/api/roots', { method: 'POST', body: JSON.stringify({ path, kind }) }),
  removeRoot: (id: number) => request<Root[]>(`/api/roots/${id}`, { method: 'DELETE' }),

  scan: () => request<{ started: boolean }>('/api/scan', { method: 'POST' }),
  backfillPlaces: () =>
    request<{ updated: number }>('/api/scan/backfill-places', { method: 'POST' }),

  thumbUrl: (id: number, size: number) => `/api/thumb/${id}?s=${size}`,
  fileUrl: (id: number) => `/api/file/${id}`,
  musicUrl: (slot: number) => `/api/music/${slot}`,
};
