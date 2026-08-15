import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function defaultDataDir(): string {
  if (process.env.PHOTON_DATA_DIR) return process.env.PHOTON_DATA_DIR;
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Photon');
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'photon');
}

export const DATA_DIR = defaultDataDir();
export const THUMB_DIR = path.join(DATA_DIR, 'thumbs');
/** Copies H.264 des vidéos illisibles par les navigateurs. Les originaux restent où ils sont. */
export const PROXY_DIR = path.join(DATA_DIR, 'videos-lisibles');
export const DB_PATH = path.join(DATA_DIR, 'photon.db');

export const PORT = Number(process.env.PHOTON_PORT ?? 7777);
/** 0.0.0.0 pour que les autres appareils du réseau local puissent se connecter. */
export const HOST = process.env.PHOTON_HOST ?? '0.0.0.0';

export function ensureDirs(): void {
  fs.mkdirSync(THUMB_DIR, { recursive: true });
  fs.mkdirSync(PROXY_DIR, { recursive: true });
}

/** Les vignettes sont réparties en 256 sous-dossiers : Windows rame au-delà de ~10k fichiers par dossier. */
export function thumbPath(id: number, size: number): string {
  const bucket = (id % 256).toString(16).padStart(2, '0');
  return path.join(THUMB_DIR, bucket, `${id}_${size}.webp`);
}

export function proxyPath(id: number): string {
  const bucket = (id % 256).toString(16).padStart(2, '0');
  return path.join(PROXY_DIR, bucket, `${id}.mp4`);
}

export const PHOTO_EXT = new Set([
  '.jpg', '.jpeg', '.jpe', '.png', '.gif', '.webp', '.bmp',
  '.tif', '.tiff', '.heic', '.heif', '.avif',
]);

export const VIDEO_EXT = new Set([
  '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi', '.mpg', '.mpeg', '.3gp',
]);

/** Dossiers qu'on ne parcourt jamais : ça ne contient jamais de photos de famille. */
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '$recycle.bin', 'system volume information',
  '.thumbnails', '.cache', 'appdata', 'windows', 'program files',
  'program files (x86)', 'photon',
]);
