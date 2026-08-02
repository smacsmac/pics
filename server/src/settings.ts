import type { Settings } from '../../shared/types.js';
import { getSetting, setSetting } from './db.js';

export const DEFAULT_SETTINGS: Settings = {
  fontScale: 2,
  hue: 285, // violet, comme sur le croquis
  volume: 3,
  lang: 'fr',
  thumbSize: 2,
  showHidden: false,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function getSettings(): Settings {
  const stored = getSetting<Partial<Settings>>('ui', {});
  return {
    fontScale: clamp(stored.fontScale, 0, 4, DEFAULT_SETTINGS.fontScale),
    hue: clamp(stored.hue, 0, 359, DEFAULT_SETTINGS.hue),
    volume: clamp(stored.volume, 0, 5, DEFAULT_SETTINGS.volume),
    lang: stored.lang === 'en' || stored.lang === 'ko' || stored.lang === 'fr' ? stored.lang : DEFAULT_SETTINGS.lang,
    thumbSize: clamp(stored.thumbSize, 0, 4, DEFAULT_SETTINGS.thumbSize),
    showHidden: stored.showHidden === true,
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  setSetting('ui', next);
  return getSettings();
}
