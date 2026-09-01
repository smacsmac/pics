/**
 * Signature visuelle d'une photo : de quoi la comparer aux autres sans rien
 * comprendre à ce qu'elle représente.
 *
 * Trois choses, toutes tirées d'une image minuscule :
 *
 * * une grille 8×8 en RGB — le « portrait-robot » de la photo, qui garde sa
 *   composition et ses couleurs en 192 octets ;
 * * une empreinte perceptive de 128 bits (dHash), qui survit au recadrage
 *   léger, au changement de qualité et à la retouche — c'est elle qui repère
 *   les quasi-doublons d'une rafale ;
 * * quelques mesures d'ambiance : clarté, saturation, richesse des couleurs,
 *   teinte dominante.
 *
 * Tout est calculé depuis la **vignette de 240 px**, pas depuis l'original :
 * relire un JPEG de 24 mégapixels pour en tirer 64 pixels serait absurde. Une
 * bibliothèque entière se signe ainsi en quelques dizaines de secondes.
 */
import fs from 'node:fs';
import sharp from 'sharp';
import type { Mood } from '../../shared/types.js';
import { thumbPath } from './paths.js';

/** Côté de la grille de couleurs. 8×8×3 = 192 octets par photo. */
const GRID = 8;

/** Taille de l'empreinte perceptive. */
const HASH_BYTES = 16;
const HASH_BITS = HASH_BYTES * 8;

export interface Signature {
  /** Grille 8×8 en RGB, ligne par ligne. */
  grid: Buffer;
  /** Empreinte dHash sur 128 bits. */
  phash: Buffer;
  /** Clarté moyenne, 0 (nuit noire) à 1 (surexposé). */
  light: number;
  /** Saturation moyenne (TSV), 0 (gris) à 1 (couleurs pures). */
  sat: number;
  /** Richesse des couleurs, 0 (terne) à 1 (éclatant). */
  colorful: number;
  /** Teinte dominante en degrés, ou null si l'image est grise. */
  hue: number | null;
}

/**
 * Décomposition d'un pixel en teinte, saturation et clarté.
 *
 * La clarté est celle de TSL — la moyenne des extrêmes —, qui correspond bien à
 * « sombre » et « clair ». La saturation, elle, est celle de **TSV** : `d/max`
 * et non la formule TSL.
 *
 * C'est délibéré. La saturation TSL s'emballe près du blanc et du noir : de la
 * neige à (215, 222, 235) y obtient 0,33 — autant qu'un vrai bleu franc — et
 * une recherche « bleu » ramenait alors toutes les photos de neige. En TSV la
 * même neige donne 0,08, ce qui dit bien ce qu'elle est : presque incolore.
 */
function toHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };

  const s = d / max;
  let h: number;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) * 60;
  else if (max === G) h = ((B - R) / d + 2) * 60;
  else h = ((R - G) / d + 4) * 60;
  return { h, s, l };
}

/**
 * Richesse des couleurs, d'après Hasler et Süsstrunk : on mesure combien les
 * axes rouge-vert et jaune-bleu s'écartent du gris. Une photo de brume et une
 * photo de carnaval se distinguent très bien ainsi, là où une simple moyenne de
 * saturation les confondrait.
 */
function colorfulness(pixels: Buffer): number {
  const n = pixels.length / 3;
  let sumRg = 0, sumYb = 0, sumRg2 = 0, sumYb2 = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRg += rg; sumYb += yb;
    sumRg2 += rg * rg; sumYb2 += yb * yb;
  }
  const meanRg = sumRg / n, meanYb = sumYb / n;
  const varRg = Math.max(0, sumRg2 / n - meanRg * meanRg);
  const varYb = Math.max(0, sumYb2 / n - meanYb * meanYb);
  const sigma = Math.sqrt(varRg + varYb);
  const mu = Math.sqrt(meanRg * meanRg + meanYb * meanYb);
  // 110 est la valeur au-delà de laquelle une image est « extrêmement colorée »
  // dans l'article d'origine ; on s'en sert pour ramener la mesure entre 0 et 1.
  return Math.min(1, (sigma + 0.3 * mu) / 110);
}

/**
 * Teinte dominante : une moyenne *circulaire*, pondérée par la saturation. Une
 * moyenne ordinaire ferait du rouge (355°) et du rouge (5°) un vert à 180°.
 */
function dominantHue(pixels: Buffer): { hue: number | null; sat: number; light: number } {
  let x = 0, y = 0, sumSat = 0, sumLight = 0, weight = 0;
  const n = pixels.length / 3;

  for (let i = 0; i < pixels.length; i += 3) {
    const { h, s, l } = toHsl(pixels[i], pixels[i + 1], pixels[i + 2]);
    sumSat += s;
    sumLight += l;
    // Les pixels ternes ou presque noirs n'ont pas de teinte fiable : ils ne
    // doivent pas tirer la moyenne vers une couleur qu'ils n'ont pas.
    const w = s * Math.min(1, l * 2) * (1 - Math.max(0, l - 0.9) * 10);
    if (w > 0) {
      const rad = (h * Math.PI) / 180;
      x += Math.cos(rad) * w;
      y += Math.sin(rad) * w;
      weight += w;
    }
  }

  const sat = sumSat / n;
  const light = sumLight / n;
  if (weight < n * 0.02) return { hue: null, sat, light };
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { hue, sat, light };
}

/**
 * dHash : on compare chaque pixel à son voisin, sur une image de 9×9 en niveaux
 * de gris. Ce qui compte est le *sens* des variations, pas leur valeur — d'où
 * la robustesse au recadrage, au redimensionnement et à la recompression.
 *
 * Les comparaisons se font **dans les deux sens**, à droite puis en dessous, ce
 * qui donne 128 bits. Avec les seules comparaisons horizontales, toute image à
 * bandes horizontales — un ciel, un mur, un dégradé — donnait une empreinte
 * entièrement nulle, donc identique à celle de n'importe quelle autre.
 */
function dHash(gray: Buffer): Buffer {
  const out = Buffer.alloc(HASH_BYTES);
  const at = (row: number, col: number): number => gray[row * 9 + col];
  let bit = 0;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (at(row, col) > at(row, col + 1)) out[bit >> 3] |= 0x80 >> (bit & 7);
      bit++;
    }
  }
  for (let col = 0; col < 8; col++) {
    for (let row = 0; row < 8; row++) {
      if (at(row, col) > at(row + 1, col)) out[bit >> 3] |= 0x80 >> (bit & 7);
      bit++;
    }
  }
  return out;
}

/**
 * Signe une photo à partir de sa vignette. Renvoie null si la vignette manque
 * ou n'est pas lisible — on réessaiera au prochain scan plutôt que d'inventer
 * une signature fausse.
 */
export async function signatureFromThumb(id: number): Promise<Signature | null> {
  const file = thumbPath(id, 240);
  if (!fs.existsSync(file)) return null;
  try {
    return await signature(await fs.promises.readFile(file));
  } catch {
    return null;
  }
}

/** Signe une image déjà en mémoire. C'est ici que tout se passe réellement. */
export async function signature(source: Buffer): Promise<Signature | null> {
  try {
    // `fit: 'fill'` déforme volontairement : deux cadrages d'une même scène
    // doivent tomber sur la même grille, quelle que soit leur proportion.
    const grid = await sharp(source, { failOn: 'none' })
      .resize(GRID, GRID, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer();

    const gray = await sharp(source, { failOn: 'none' })
      .resize(9, 9, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    if (grid.length !== GRID * GRID * 3 || gray.length !== 81) return null;

    const { hue, sat, light } = dominantHue(grid);
    return {
      grid,
      phash: dHash(gray),
      light,
      sat,
      colorful: colorfulness(grid),
      hue: hue === null ? null : Math.round(hue),
    };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- comparaisons

/**
 * Nombre de bits qui diffèrent entre deux empreintes. 0 = identiques, 128 = tout
 * oppose. Deux empreintes de tailles différentes viennent d'une version
 * antérieure du calcul : on les déclare incomparables plutôt que de les faire
 * passer pour proches.
 */
export function hamming(a: Buffer, b: Buffer): number {
  if (a.length !== HASH_BYTES || b.length !== HASH_BYTES) return HASH_BITS;
  let d = 0;
  for (let i = 0; i < HASH_BYTES; i++) {
    let x = a[i] ^ b[i];
    while (x) {
      x &= x - 1;
      d++;
    }
  }
  return d;
}

/** Écart entre deux grilles, ramené entre 0 (identiques) et 1 (tout oppose). */
export function gridDistance(a: Buffer, b: Buffer): number {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  if (n === 0) return 1;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum / n) / 255;
}

/**
 * Ressemblance entre deux photos, de 0 à 1. La grille porte l'essentiel — c'est
 * elle qui sait que deux photos montrent la même scène — et l'empreinte
 * tranche entre deux images de composition voisine.
 */
export function similarity(
  a: { grid: Buffer; phash: Buffer },
  b: { grid: Buffer; phash: Buffer },
): number {
  const g = gridDistance(a.grid, b.grid);
  const h = hamming(a.phash, b.phash) / HASH_BITS;
  return Math.max(0, 1 - (0.7 * g + 0.3 * h));
}

// ---------------------------------------------------------------- ambiances

/**
 * Les ambiances proposées dans la recherche. Ce sont des règles, pas de la
 * reconnaissance : « coucher de soleil » veut dire « tons chauds, saturés, ni
 * trop clairs ni trop sombres », ce qui attrape aussi bien un vrai coucher de
 * soleil qu'un mur ocre en fin de journée. Assumé : c'est utile et honnête.
 */
export interface MoodStats {
  light: number;
  sat: number;
  colorful: number;
  hue: number | null;
}

/** Vrai si la teinte tombe dans l'arc donné, en tenant compte du passage par 0°. */
function inArc(hue: number, from: number, to: number): boolean {
  return from <= to ? hue >= from && hue <= to : hue >= from || hue <= to;
}

export function matchesMood(mood: Mood, s: MoodStats): boolean {
  switch (mood) {
    case 'dark':
      return s.light < 0.3;
    case 'bright':
      return s.light > 0.68;
    case 'bw':
      // Une vraie photo monochrome n'a aucune couleur *ni aucune variation* de
      // couleur. La saturation seule ne suffisait pas : de la neige, presque
      // incolore, passait pour du noir et blanc. La richesse tranche nettement
      // — 0,002 pour un tirage argentique contre 0,056 pour de la neige bleutée.
      return s.sat < 0.08 && s.colorful < 0.03;
    case 'vivid':
      // Seuil repris de l'échelle de Hasler et Süsstrunk : 0,54 correspond à
      // leur « quite colourful ». Plus bas, les deux tiers d'une bibliothèque
      // ressortent et le filtre ne filtre plus rien.
      return s.colorful > 0.54 && s.sat > 0.45;
    case 'green':
      return s.hue !== null && inArc(s.hue, 75, 165) && s.sat > 0.18;
    case 'blue':
      return s.hue !== null && inArc(s.hue, 175, 260) && s.sat > 0.18;
    case 'warm':
      return s.hue !== null && inArc(s.hue, 340, 60) && s.sat > 0.22;
    case 'sunset':
      return (
        s.hue !== null && inArc(s.hue, 355, 45) &&
        s.sat > 0.35 && s.light > 0.22 && s.light < 0.62
      );
    default:
      return false;
  }
}

/**
 * Traduction des ambiances en conditions SQL, pour ne pas rapatrier toute la
 * bibliothèque en mémoire à chaque recherche. Le résultat est le même que
 * `matchesMood` — les deux se vérifient l'un contre l'autre dans les essais.
 */
export function moodSql(mood: Mood): string | null {
  switch (mood) {
    case 'dark': return 'm.sig_light < 0.3';
    case 'bright': return 'm.sig_light > 0.68';
    case 'bw': return 'm.sig_sat < 0.08 AND m.sig_colorful < 0.03';
    case 'vivid': return 'm.sig_colorful > 0.54 AND m.sig_sat > 0.45';
    case 'green': return 'm.sig_hue BETWEEN 75 AND 165 AND m.sig_sat > 0.18';
    case 'blue': return 'm.sig_hue BETWEEN 175 AND 260 AND m.sig_sat > 0.18';
    case 'warm': return '(m.sig_hue >= 340 OR m.sig_hue <= 60) AND m.sig_sat > 0.22';
    case 'sunset':
      return '(m.sig_hue >= 355 OR m.sig_hue <= 45) AND m.sig_sat > 0.35' +
        ' AND m.sig_light > 0.22 AND m.sig_light < 0.62';
    default: return null;
  }
}
