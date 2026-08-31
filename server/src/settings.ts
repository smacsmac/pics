import type { AlbumSort, Settings, ZoomKey, ZoomLevels } from '../../shared/types.js';
import { getSetting, setSetting } from './db.js';

const ZOOM_KEYS: ZoomKey[] = ['timeline', 'videos', 'album', 'albums'];
const ALBUM_SORTS: AlbumSort[] = ['recent', 'name', 'yearDesc', 'yearAsc'];

export const DEFAULT_SETTINGS: Settings = {
  fontScale: 2,
  hue: 285, // violet, comme sur le croquis
  volume: 3,
  lang: 'fr',
  zoom: { timeline: 2, videos: 2, album: 2, albums: 2 },
  showHidden: false,
  layout: 'day',
  albumSort: 'recent',
  // Ouvert par défaut : l'intérêt est justement que n'importe quel appareil du
  // Wi-Fi puisse envoyer ses photos sans connaître le mot de passe.
  uploadRequiresAdmin: false,
  slideshowSeconds: 5,
  slideshowShuffle: false,
  slideshowPan: true,
  screensaverMinutes: 0,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Reprend l'ancien réglage unique `thumbSize` pour les installations qui
 * existaient avant que le zoom devienne propre à chaque écran.
 */
function readZoom(stored: Partial<Settings> & { thumbSize?: number }): ZoomLevels {
  const legacy = clamp(stored.thumbSize, 0, 4, DEFAULT_SETTINGS.zoom.timeline);
  const source = (stored.zoom ?? {}) as Partial<ZoomLevels>;
  const zoom = {} as ZoomLevels;
  for (const key of ZOOM_KEYS) zoom[key] = clamp(source[key], 0, 4, legacy);
  return zoom;
}

export function getSettings(): Settings {
  const stored = getSetting<Partial<Settings> & { thumbSize?: number }>('ui', {});
  return {
    fontScale: clamp(stored.fontScale, 0, 4, DEFAULT_SETTINGS.fontScale),
    hue: clamp(stored.hue, 0, 359, DEFAULT_SETTINGS.hue),
    volume: clamp(stored.volume, 0, 5, DEFAULT_SETTINGS.volume),
    lang: stored.lang === 'en' || stored.lang === 'ko' || stored.lang === 'fr' ? stored.lang : DEFAULT_SETTINGS.lang,
    zoom: readZoom(stored),
    showHidden: stored.showHidden === true,
    layout: stored.layout === 'compact' ? 'compact' : 'day',
    albumSort: ALBUM_SORTS.includes(stored.albumSort as AlbumSort)
      ? (stored.albumSort as AlbumSort)
      : DEFAULT_SETTINGS.albumSort,
    uploadRequiresAdmin: stored.uploadRequiresAdmin === true,
    slideshowSeconds: clamp(stored.slideshowSeconds, 2, 30, DEFAULT_SETTINGS.slideshowSeconds),
    slideshowShuffle: stored.slideshowShuffle === true,
    // Le mouvement est agréable par défaut ; il faut le refuser explicitement.
    slideshowPan: stored.slideshowPan !== false,
    screensaverMinutes: clamp(stored.screensaverMinutes, 0, 60, DEFAULT_SETTINGS.screensaverMinutes),
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const current = getSettings();
  // Le zoom se met à jour par écran : un patch partiel ne doit pas effacer les
  // niveaux des autres vues.
  const next: Settings = {
    ...current,
    ...patch,
    zoom: { ...current.zoom, ...(patch.zoom ?? {}) },
  };
  setSetting('ui', next);
  return getSettings();
}
