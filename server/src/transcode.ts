/**
 * Lecture des vidéos que le navigateur ne sait pas décoder.
 *
 * Les téléphones récents (Pixel, iPhone) filment en HEVC/H.265. Chrome et Firefox
 * ne décodent pas ce format : on voit la première image figée et on entend le
 * son, ce qui donne l'illusion d'un fichier corrompu alors qu'il est parfait —
 * il s'ouvre très bien dans l'explorateur Windows.
 *
 * On fabrique donc une copie H.264 lisible partout, rangée dans le dossier de
 * données de l'application. Le fichier d'origine n'est jamais touché, ni
 * déplacé, ni réécrit : c'est une copie de lecture, à côté des vignettes.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { proxyPath } from './paths.js';
import { probeVideo } from './thumbs.js';

/**
 * Ce que tous les navigateurs visés savent lire dans une balise <video>.
 * HEVC en est volontairement absent : même là où Chrome l'accepte, ça dépend du
 * matériel et des extensions installées, donc on ne peut pas s'y fier.
 */
const BROWSER_VIDEO = new Set(['h264', 'avc1', 'vp8', 'vp9', 'av1', 'theora']);
const BROWSER_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac', '']);

/** Conteneurs qu'on peut servir tels quels quand le codec est bon. */
const BROWSER_CONTAINER = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov']);

export type ProxyState = 'ready' | 'working' | 'error';

export interface PlaybackInfo {
  /** true : le fichier d'origine passe tel quel dans le navigateur. */
  direct: boolean;
  state: ProxyState;
  /** Avancement de la conversion, 0 à 1. */
  progress: number;
  /** Ce que la balise <video> doit charger, quand c'est prêt. */
  url: string | null;
  vcodec: string | null;
}

interface Job {
  progress: number;
  promise: Promise<boolean>;
}

const jobs = new Map<number, Job>();
/** Conversions ratées : on ne relance pas ffmpeg à chaque ouverture. */
const failed = new Set<number>();

let ffmpegBin: string | null | undefined;

async function ffmpeg(): Promise<string> {
  if (ffmpegBin !== undefined && ffmpegBin !== null) return ffmpegBin;
  try {
    const mod = await import('ffmpeg-static');
    const bin = (mod.default ?? mod) as unknown as string | null;
    if (bin && fs.existsSync(bin)) {
      ffmpegBin = bin;
      return bin;
    }
  } catch {
    /* on tente le PATH */
  }
  ffmpegBin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return ffmpegBin;
}

interface Row {
  id: number;
  path: string;
  kind: string;
  ext: string;
  duration: number | null;
  vcodec: string | null;
  acodec: string | null;
}

function mediaRow(id: number): Row | undefined {
  return db
    .prepare(`SELECT id, path, kind, ext, duration, vcodec, acodec FROM media WHERE id = ?`)
    .get(id) as Row | undefined;
}

/**
 * Les vidéos indexées avant l'ajout de ces colonnes n'ont pas de codec connu :
 * on le lit à la première lecture plutôt que d'imposer un nouveau scan complet
 * de toute la bibliothèque.
 */
async function ensureCodec(row: Row): Promise<Row> {
  if (row.vcodec !== null) return row;
  const probe = await probeVideo(row.path);
  db.prepare(`UPDATE media SET vcodec = ?, acodec = ? WHERE id = ?`).run(
    probe.vcodec ?? 'inconnu',
    probe.acodec ?? '',
    row.id,
  );
  return { ...row, vcodec: probe.vcodec ?? 'inconnu', acodec: probe.acodec ?? '' };
}

function videoOk(row: Row): boolean {
  return row.vcodec !== null && BROWSER_VIDEO.has(row.vcodec);
}

function audioOk(row: Row): boolean {
  return BROWSER_AUDIO.has(row.acodec ?? '');
}

function playsDirectly(row: Row): boolean {
  return BROWSER_CONTAINER.has(row.ext.toLowerCase()) && videoOk(row) && audioOk(row);
}

/**
 * Une conversion à la fois. ffmpeg occupe déjà tous les cœurs : en lancer
 * plusieurs ne va pas plus vite et rendrait le PC inutilisable. Traverser dix
 * vidéos aux flèches ne doit pas déclencher dix encodages simultanés.
 */
let queue: Promise<unknown> = Promise.resolve();

/** Lance la conversion si elle n'est pas déjà faite ou en cours. */
function startJob(row: Row): Job {
  const existing = jobs.get(row.id);
  if (existing) return existing;

  const dest = proxyPath(row.id);
  const partial = `${dest}.partiel.mp4`;
  const job: Job = { progress: 0, promise: Promise.resolve(false) };

  const work = async (): Promise<boolean> => {
    const bin = await ffmpeg();
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.rm(partial, { force: true }).catch(() => {});

    const total = row.duration && row.duration > 0 ? row.duration : null;

    // Un .mkv ou un .avi dont les pistes sont déjà lisibles n'a pas besoin
    // d'être réencodé : on les recopie telles quelles dans un MP4. Quelques
    // secondes au lieu de longues minutes, et sans perte de qualité.
    const videoArgs = videoOk(row)
      ? ['-c:v', 'copy']
      : [
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
          '-pix_fmt', 'yuv420p',
          // Certains capteurs sortent une hauteur impaire ; libx264 refuse.
          '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
        ];
    const audioArgs = audioOk(row) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k'];

    return await new Promise<boolean>((resolve) => {
      const child = spawn(
        bin,
        [
          '-hide_banner', '-loglevel', 'error', '-nostdin',
          '-i', row.path,
          // -autorotate est actif par défaut : une vidéo filmée à la verticale
          // ressort droite, sans quoi elle serait couchée dans la copie.
          '-map', '0:v:0', '-map', '0:a?',
          ...videoArgs,
          ...audioArgs,
          // La lecture peut commencer avant la fin du téléchargement.
          '-movflags', '+faststart',
          '-progress', 'pipe:1', '-y', partial,
        ],
        { windowsHide: true },
      );

      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        // ffmpeg écrit « out_time_us=1234567 » à intervalles réguliers.
        const m = /out_time_us=(\d+)/g;
        let last: RegExpExecArray | null;
        let latest: number | null = null;
        while ((last = m.exec(chunk.toString())) !== null) latest = Number(last[1]);
        if (latest !== null && total) {
          job.progress = Math.min(0.99, latest / 1_000_000 / total);
        }
      });
      child.stderr.on('data', (c: Buffer) => {
        if (stderr.length < 8000) stderr += c.toString();
      });

      const finish = async (ok: boolean): Promise<void> => {
        jobs.delete(row.id);
        if (ok) {
          await fs.promises.rename(partial, dest).catch(() => {});
          job.progress = 1;
        } else {
          await fs.promises.rm(partial, { force: true }).catch(() => {});
          failed.add(row.id);
          console.warn(`Conversion vidéo impossible (média ${row.id}) : ${stderr.trim()}`);
        }
        resolve(ok);
      };

      child.on('error', () => void finish(false));
      child.on('close', (code) => void finish(code === 0));
    });
  };

  // On s'attache à la file : la conversion démarre quand la précédente finit.
  // Un échec ne doit jamais bloquer les suivantes, d'où le catch.
  job.promise = queue.then(work, work);
  queue = job.promise.catch(() => false);

  jobs.set(row.id, job);
  return job;
}

/** Point d'entrée de l'API : où en est la lecture de cette vidéo ? */
export async function playbackInfo(id: number): Promise<PlaybackInfo | null> {
  const base = mediaRow(id);
  if (!base || base.kind !== 'video') return null;
  const row = await ensureCodec(base);

  if (playsDirectly(row)) {
    return { direct: true, state: 'ready', progress: 1, url: `/api/file/${id}`, vcodec: row.vcodec };
  }

  const dest = proxyPath(id);
  if (fs.existsSync(dest)) {
    return { direct: false, state: 'ready', progress: 1, url: `/api/file/${id}/proxy`, vcodec: row.vcodec };
  }
  if (failed.has(id)) {
    return { direct: false, state: 'error', progress: 0, url: null, vcodec: row.vcodec };
  }

  const job = startJob(row);
  return { direct: false, state: 'working', progress: job.progress, url: null, vcodec: row.vcodec };
}

export function proxyFile(id: number): string | null {
  const file = proxyPath(id);
  return fs.existsSync(file) ? file : null;
}

/** Une vidéo retirée de la bibliothèque n'a plus besoin de sa copie de lecture. */
export async function removeProxy(id: number): Promise<void> {
  jobs.delete(id);
  failed.delete(id);
  await fs.promises.rm(proxyPath(id), { force: true }).catch(() => {});
}
