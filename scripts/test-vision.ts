/**
 * Vérification de la signature visuelle.  `npm run test:vision`
 *
 * On fabrique des images dont on connaît la couleur, la clarté et le contenu,
 * on les signe avec le vrai module du serveur, et on vérifie que les mesures,
 * les ambiances, les empreintes et les ressemblances tombent juste. Aucun
 * fichier n'est écrit : tout se passe en mémoire.
 */
import sharp from 'sharp';
import type { Mood } from '../shared/types.js';
import { MOODS } from '../shared/types.js';
import {
  gridDistance, hamming, matchesMood, moodSql, signature, similarity,
} from '../server/src/vision.js';

let pass = 0;
let fail = 0;
const ok = (nom: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK   ' : 'ECHEC'} ${nom}${extra ? '  ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};

/** Une image d'une seule couleur. */
function uni(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 240, height: 180, channels: 3, background: { r, g, b } } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

/** Une scène : des bandes de couleurs, pour avoir une composition reconnaissable. */
async function scene(colors: Array<[number, number, number]>, w = 240, h = 180): Promise<Buffer> {
  const bandH = Math.ceil(h / colors.length);
  const bands = await Promise.all(
    colors.map(([r, g, b]) =>
      sharp({ create: { width: w, height: bandH, channels: 3, background: { r, g, b } } })
        .png()
        .toBuffer()),
  );
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .composite(bands.map((input, i) => ({ input, top: i * bandH, left: 0 })))
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function sig(buf: Buffer): ReturnType<typeof signature> extends Promise<infer T>
  ? Promise<NonNullable<T>>
  : never {
  const s = await signature(buf);
  if (!s) throw new Error('signature nulle');
  return s;
}

console.log('=== mesures sur des couleurs connues ===');
{
  const noir = await sig(await uni(8, 8, 8));
  const blanc = await sig(await uni(248, 248, 248));
  const gris = await sig(await uni(128, 128, 128));
  const rouge = await sig(await uni(220, 30, 30));
  const vert = await sig(await uni(40, 190, 60));
  const bleu = await sig(await uni(40, 90, 220));

  ok('le noir est sombre', noir.light < 0.1, `clarte ${noir.light.toFixed(2)}`);
  ok('le blanc est clair', blanc.light > 0.9, `clarte ${blanc.light.toFixed(2)}`);
  ok('le gris est a mi-chemin', Math.abs(gris.light - 0.5) < 0.05, `clarte ${gris.light.toFixed(2)}`);
  ok('le gris n a pas de teinte', gris.hue === null, `teinte ${gris.hue}`);
  ok('le gris n est pas sature', gris.sat < 0.02, `sat ${gris.sat.toFixed(3)}`);
  ok('le rouge est reconnu', rouge.hue !== null && (rouge.hue < 15 || rouge.hue > 345), `teinte ${rouge.hue}`);
  ok('le vert est reconnu', vert.hue !== null && vert.hue > 90 && vert.hue < 150, `teinte ${vert.hue}`);
  ok('le bleu est reconnu', bleu.hue !== null && bleu.hue > 200 && bleu.hue < 240, `teinte ${bleu.hue}`);
}

console.log('\n=== la teinte moyenne ne se perd pas en passant par 0 degre ===');
{
  // Un rouge tirant vers le rose et un rouge tirant vers l'orange : la moyenne
  // doit rester rouge, pas basculer dans le vert a l'oppose du cercle.
  const s = await sig(await scene([[220, 20, 70], [220, 70, 20]]));
  ok('deux rouges donnent du rouge', s.hue !== null && (s.hue < 30 || s.hue > 330), `teinte ${s.hue}`);
}

console.log('\n=== richesse des couleurs ===');
{
  const terne = await sig(await scene([[120, 118, 122], [130, 128, 132], [110, 112, 110]]));
  const carnaval = await sig(await scene([[240, 20, 20], [20, 240, 20], [20, 20, 240], [250, 240, 20]]));
  ok('une image grise est terne', terne.colorful < 0.1, terne.colorful.toFixed(2));
  ok('une image bariolee est riche', carnaval.colorful > 0.5, carnaval.colorful.toFixed(2));
  ok('la seconde depasse nettement la premiere', carnaval.colorful > terne.colorful * 5);
}

console.log('\n=== ambiances ===');
{
  const cas: Array<[string, Buffer, Mood[], Mood[]]> = [
    ['nuit', await uni(20, 20, 28), ['dark'], ['bright', 'vivid']],
    ['plage en plein soleil', await uni(238, 232, 216), ['bright'], ['dark', 'bw']],
    ['noir et blanc', await scene([[30, 30, 30], [140, 140, 140], [230, 230, 230]]), ['bw'], ['vivid', 'green', 'blue']],
    ['feuillage', await scene([[40, 130, 45], [60, 160, 55], [30, 110, 40]]), ['green'], ['blue', 'bw', 'warm']],
    ['mer', await scene([[30, 90, 190], [40, 110, 210], [25, 80, 170]]), ['blue'], ['green', 'bw', 'warm']],
    // De la neige : presque incolore, mais ce n'est pas du noir et blanc.
    ['neige', await scene([[238, 240, 245], [225, 230, 242], [215, 222, 235]]), ['bright'], ['bw', 'blue', 'vivid', 'dark']],
    ['coucher de soleil', await scene([[200, 90, 20], [225, 120, 30], [180, 60, 15]]), ['warm', 'sunset'], ['blue', 'green', 'bw']],
  ];

  for (const [nom, buf, attendus, exclus] of cas) {
    const s = await sig(buf);
    const stats = { light: s.light, sat: s.sat, colorful: s.colorful, hue: s.hue };
    const trouves = MOODS.filter((m) => matchesMood(m, stats));
    const manque = attendus.filter((m) => !trouves.includes(m));
    const parasite = exclus.filter((m) => trouves.includes(m));
    ok(
      `« ${nom} »`,
      manque.length === 0 && parasite.length === 0,
      `-> [${trouves.join(', ')}]` +
        `${manque.length ? ` MANQUE ${manque.join(',')}` : ''}` +
        `${parasite.length ? ` DE TROP ${parasite.join(',')}` : ''}`,
    );
  }
}

console.log('\n=== empreinte perceptive ===');
{
  const base = await scene([[200, 40, 40], [40, 200, 40], [40, 40, 200], [230, 220, 40]]);
  const a = await sig(base);

  const abimee = await sig(await sharp(base).jpeg({ quality: 20 }).toBuffer());
  ok('elle survit a une forte recompression', hamming(a.phash, abimee.phash) <= 4,
     `distance ${hamming(a.phash, abimee.phash)}/128`);

  const petite = await sig(await sharp(base).resize(120, 90).jpeg().toBuffer());
  ok('elle survit au redimensionnement', hamming(a.phash, petite.phash) <= 8,
     `distance ${hamming(a.phash, petite.phash)}/128`);

  // Une image faite de bandes horizontales n'a aucune variation vers la droite :
  // avec les seules comparaisons horizontales, son empreinte etait nulle, donc
  // identique a celle de n'importe quelle autre image a bandes.
  const autre = await sig(await scene([[20, 20, 40], [200, 200, 220], [30, 60, 30]]));
  ok('une autre image est loin', hamming(a.phash, autre.phash) >= 24,
     `distance ${hamming(a.phash, autre.phash)}/128`);

  const vide = Buffer.alloc(8);
  ok('deux empreintes de tailles differentes sont incomparables',
     hamming(a.phash, vide) === 128);
}

console.log('\n=== ressemblance ===');
{
  const base = await scene([[200, 40, 40], [40, 200, 40], [40, 40, 200], [230, 220, 40]]);
  const a = await sig(base);
  const presquePareil = await sig(await sharp(base).modulate({ brightness: 1.05 }).jpeg().toBuffer());
  const autreScene = await sig(await scene([[20, 20, 40], [200, 200, 220], [30, 60, 30]]));

  const proche = similarity(a, presquePareil);
  const loin = similarity(a, autreScene);
  ok('deux prises de la meme scene se ressemblent', proche > 0.85, proche.toFixed(3));
  ok('deux scenes differentes ne se ressemblent pas', loin < 0.72, loin.toFixed(3));
  ok('la ressemblance est bien ordonnee', proche > loin, `${proche.toFixed(2)} > ${loin.toFixed(2)}`);
  ok('une image est identique a elle-meme', similarity(a, a) === 1);
  ok('la distance de grille est nulle sur soi-meme', gridDistance(a.grid, a.grid) === 0);

  // Meme composition, couleurs opposees. L'empreinte les declare identiques —
  // elle ne regarde que la structure — et c'est la grille qui doit trancher.
  // Sans quoi une foret et un ocean passeraient pour la meme photo.
  const memeStructure = await sig(await scene([[40, 40, 200], [200, 40, 40], [230, 220, 40], [40, 200, 40]]));
  const structure = similarity(a, memeStructure);
  ok('des couleurs opposees ne se ressemblent pas', structure < 0.88,
     `${structure.toFixed(3)} (empreinte ${hamming(a.phash, memeStructure.phash)}/128)`);
}

console.log('\n=== les regles SQL disent la meme chose que le code ===');
{
  // Les ambiances sont decidees a deux endroits : en SQL pour filtrer la base
  // sans tout rapatrier, et en JavaScript pour le reste. Les deux doivent
  // toujours tomber d'accord — on le verifie sur des mesures tirees au hasard.
  let desaccords = 0;
  let testes = 0;
  for (let i = 0; i < 4000; i++) {
    const s = {
      light: Math.random(),
      sat: Math.random(),
      colorful: Math.random(),
      hue: Math.random() < 0.1 ? null : Math.floor(Math.random() * 360),
    };
    for (const m of MOODS) {
      const parCode = matchesMood(m, s);
      const expr = moodSql(m)!
        .replace(/m\.sig_light/g, String(s.light))
        .replace(/m\.sig_sat/g, String(s.sat))
        .replace(/m\.sig_colorful/g, String(s.colorful))
        .replace(/m\.sig_hue BETWEEN (\d+) AND (\d+)/g,
          (_x, a: string, b: string) => (s.hue !== null && s.hue >= +a && s.hue <= +b ? 'true' : 'false'))
        .replace(/m\.sig_hue >= (\d+)/g, (_x, a: string) => (s.hue !== null && s.hue >= +a ? 'true' : 'false'))
        .replace(/m\.sig_hue <= (\d+)/g, (_x, a: string) => (s.hue !== null && s.hue <= +a ? 'true' : 'false'))
        .replace(/ AND /g, ' && ')
        .replace(/ OR /g, ' || ');
      // eslint-disable-next-line no-eval
      const parSql = Boolean(eval(expr));
      testes++;
      if (parCode !== parSql) desaccords++;
    }
  }
  ok('code et SQL sont d accord', desaccords === 0, `${testes - desaccords}/${testes} cas concordants`);
}

console.log(`\n${pass} reussites, ${fail} echec${fail === 1 ? '' : 's'}`);
process.exit(fail === 0 ? 0 : 1);
