import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { thumbPath } from './paths.js';

export const THUMB_SIZES = [240, 480, 960] as const;

sharp.cache({ files: 0, memory: 96 });
sharp.concurrency(2);

let ffmpegBin: string | null | undefined;

/**
 * ffmpeg-static livre un binaire par plateforme ; s'il manque (installation
 * partielle, antivirus…) on retombe sur un ffmpeg du PATH, et sinon on se passe
 * simplement des vignettes vidéo.
 */
async function ffmpeg(): Promise<string | null> {
  if (ffmpegBin !== undefined) return ffmpegBin;
  try {
    const mod = await import('ffmpeg-static');
    const bin = (mod.default ?? mod) as unknown as string | null;
    if (bin && fs.existsSync(bin)) {
      ffmpegBin = bin;
      return ffmpegBin;
    }
  } catch {
    /* on tente le PATH */
  }
  ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return ffmpegBin;
}

function run(bin: string, args: string[], timeoutMs = 30_000): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const out: Buffer[] = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => {
      if (err.length < 64_000) err += c.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

/** Certains HEIC ne sont pas décodables par les binaires sharp préconstruits. */
async function decodeToBuffer(file: string): Promise<Buffer> {
  const ext = path.extname(file).toLowerCase();
  if (ext !== '.heic' && ext !== '.heif') return fs.promises.readFile(file);
  try {
    await sharp(file).metadata();
    return await fs.promises.readFile(file);
  } catch {
    const mod = await import('heic-convert');
    const convert = (mod.default ?? mod) as unknown as (opts: {
      buffer: Buffer;
      format: 'JPEG' | 'PNG';
      quality?: number;
    }) => Promise<ArrayBuffer>;
    const input = await fs.promises.readFile(file);
    const jpeg = await convert({ buffer: input, format: 'JPEG', quality: 0.92 });
    return Buffer.from(jpeg);
  }
}

export interface VideoProbe {
  duration: number | null;
  width: number | null;
  height: number | null;
  createdAt: number | null;
}

/**
 * ffmpeg-static n'embarque pas ffprobe, alors on lit ce que ffmpeg raconte sur
 * stderr quand on lui donne un fichier sans sortie. Moins élégant, zéro dépendance
 * supplémentaire.
 */
export async function probeVideo(file: string): Promise<VideoProbe> {
  const result: VideoProbe = { duration: null, width: null, height: null, createdAt: null };
  const bin = await ffmpeg();
  if (!bin) return result;
  try {
    const { stderr } = await run(bin, ['-hide_banner', '-i', file], 20_000);
    const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (dur) {
      result.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
    }
    const dim = stderr.match(/,\s*(\d{2,5})x(\d{2,5})[\s,]/);
    if (dim) {
      result.width = Number(dim[1]);
      result.height = Number(dim[2]);
    }
    const created = stderr.match(/creation_time\s*:\s*(\S+)/);
    if (created) {
      const t = Date.parse(created[1]);
      if (!Number.isNaN(t)) result.createdAt = t;
    }
  } catch {
    /* pas de ffmpeg : on se contente de la date du fichier */
  }
  return result;
}

async function videoFrame(file: string, seconds: number): Promise<Buffer | null> {
  const bin = await ffmpeg();
  if (!bin) return null;
  try {
    const { code, stdout } = await run(
      bin,
      ['-hide_banner', '-loglevel', 'error', '-ss', String(seconds), '-i', file,
       '-frames:v', '1', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1'],
      45_000,
    );
    if (code === 0 && stdout.length > 0) return stdout;
  } catch {
    /* ignoré */
  }
  return null;
}

/**
 * Fabrique les trois tailles de vignette d'un média. Renvoie false si le fichier
 * est illisible, pour qu'on arrête d'y revenir à chaque scan.
 */
export async function makeThumbs(id: number, file: string, kind: 'photo' | 'video'): Promise<boolean> {
  let source: Buffer | null;
  if (kind === 'video') {
    // Une frame à 1 s : la toute première est souvent noire.
    source = (await videoFrame(file, 1)) ?? (await videoFrame(file, 0));
    if (!source) return false;
  } else {
    try {
      source = await decodeToBuffer(file);
    } catch {
      return false;
    }
  }

  try {
    for (const size of THUMB_SIZES) {
      const dest = thumbPath(id, size);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await sharp(source, { failOn: 'none' })
        .rotate() // applique l'orientation EXIF
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: size >= 960 ? 82 : 74, effort: 3 })
        .toFile(dest);
    }
    return true;
  } catch {
    return false;
  }
}

export async function removeThumbs(id: number): Promise<void> {
  await Promise.all(
    THUMB_SIZES.map((s) => fs.promises.rm(thumbPath(id, s), { force: true }).catch(() => {})),
  );
}

export function nearestThumbSize(requested: number): number {
  let best: number = THUMB_SIZES[0];
  for (const s of THUMB_SIZES) if (s >= requested) return s;
  best = THUMB_SIZES[THUMB_SIZES.length - 1];
  return best;
}
