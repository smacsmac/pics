/**
 * Fabrique une bibliothèque de démonstration : des images avec de vrais EXIF
 * (date de prise de vue, appareil, coordonnées GPS) et quelques vidéos courtes.
 *
 *   npm run seed              → ./demo-photos
 *   npm run seed -- C:\chemin → dossier au choix
 *
 * Sert à essayer l'application avant d'y brancher ses vraies photos.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const OUT = path.resolve(process.argv[2] ?? 'demo-photos');

interface Spot {
  name: string;
  lat: number;
  lon: number;
  hues: [number, number];
}

const SPOTS: Spot[] = [
  { name: 'Hamilton', lat: 43.2501, lon: -79.8496, hues: [150, 200] },
  { name: 'Montreal', lat: 45.5088, lon: -73.5878, hues: [265, 310] },
  { name: 'Seoul', lat: 37.5665, lon: 126.978, hues: [330, 20] },
  { name: 'Vancouver', lat: 49.2827, lon: -123.1207, hues: [190, 240] },
];

/** Décimal → « 43/1 15/1 3/1 », le format des rationnels EXIF. */
function toDms(value: number): string {
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const sec = Math.round((minFloat - min) * 60 * 100);
  return `${deg}/1 ${min}/1 ${sec}/100`;
}

function exifDate(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function gradient(width: number, height: number, h1: number, h2: number, label: string): Buffer {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="hsl(${h1},70%,45%)"/>
      <stop offset="100%" stop-color="hsl(${h2},75%,22%)"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <circle cx="${width * 0.72}" cy="${height * 0.28}" r="${Math.min(width, height) * 0.16}"
          fill="hsl(${(h1 + 40) % 360},90%,72%)" opacity="0.55"/>
  <text x="${width / 2}" y="${height - height * 0.08}" font-family="sans-serif"
        font-size="${Math.round(height * 0.07)}" fill="rgba(255,255,255,0.82)"
        text-anchor="middle">${label}</text>
</svg>`);
}

async function makeVideo(file: string, seconds: number, hue: number): Promise<boolean> {
  let bin: string;
  try {
    const mod = await import('ffmpeg-static');
    bin = ((mod.default ?? mod) as unknown as string) || 'ffmpeg';
  } catch {
    bin = 'ffmpeg';
  }
  return new Promise((resolve) => {
    const child = spawn(
      bin,
      ['-y', '-loglevel', 'error', '-f', 'lavfi',
       '-i', `color=c=0x${hue.toString(16).padStart(6, '0')}:s=640x360:d=${seconds}`,
       '-f', 'lavfi', '-i', `sine=frequency=${220 + hue % 400}:duration=${seconds}`,
       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file],
      { windowsHide: true },
    );
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

async function main(): Promise<void> {
  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Génération de la bibliothèque de démonstration dans ${OUT}`);

  // Une dizaine de journées réparties sur trois ans, avec plusieurs photos chacune.
  const days = [
    new Date(2024, 4, 18), new Date(2024, 7, 3), new Date(2024, 11, 25),
    new Date(2025, 2, 14), new Date(2025, 5, 30), new Date(2025, 8, 9),
    new Date(2025, 9, 21), new Date(2026, 0, 5), new Date(2026, 3, 12),
    new Date(2026, 6, 12),
  ];

  let made = 0;
  for (let d = 0; d < days.length; d++) {
    const day = days[d];
    const spot = SPOTS[d % SPOTS.length];
    const shots = 3 + ((d * 3) % 5);

    for (let i = 0; i < shots; i++) {
      const taken = new Date(day);
      taken.setHours(9 + i * 2, (i * 17) % 60, (i * 29) % 60);

      const portrait = (d + i) % 3 === 0;
      const width = portrait ? 900 : 1400;
      const height = portrait ? 1400 : 900;
      const hue = (spot.hues[0] + i * 13) % 360;
      const label = `${spot.name} ${taken.getFullYear()}`;

      const file = path.join(
        OUT,
        `IMG_${taken.getFullYear()}${String(taken.getMonth() + 1).padStart(2, '0')}${String(taken.getDate()).padStart(2, '0')}_${String(i).padStart(3, '0')}.jpg`,
      );

      await sharp(gradient(width, height, hue, spot.hues[1], label))
        .jpeg({ quality: 88 })
        .withExif({
          IFD0: { Make: 'Photon', Model: 'Demo Camera' },
          IFD2: { DateTimeOriginal: exifDate(taken) },
          IFD3: {
            GPSLatitudeRef: spot.lat >= 0 ? 'N' : 'S',
            GPSLatitude: toDms(spot.lat),
            GPSLongitudeRef: spot.lon >= 0 ? 'E' : 'W',
            GPSLongitude: toDms(spot.lon),
          },
        })
        .toFile(file);

      fs.utimesSync(file, taken, taken);
      made++;
    }
  }

  let videos = 0;
  for (let v = 0; v < 3; v++) {
    const day = days[(v * 3) % days.length];
    const file = path.join(
      OUT,
      `VID_${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}_00${v}.mp4`,
    );
    if (await makeVideo(file, 3 + v, 0x2a1a4a + v * 0x201030)) {
      fs.utimesSync(file, day, day);
      videos++;
    }
  }

  console.log(`  ${made} photos, ${videos} vidéos.`);
  console.log('');
  console.log('Ajoutez ce dossier dans Réglages → Dossiers, puis lancez un scan.');
  if (videos === 0) console.log('(ffmpeg indisponible : aucune vidéo générée, ce n’est pas bloquant.)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
