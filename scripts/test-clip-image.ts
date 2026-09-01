/**
 * Conformité de la préparation d'image pour CLIP.
 * `npm run test:clip-image -- <dossier>`
 *
 * Compare notre tenseur à celui de la chaîne officielle de PyTorch, sur des
 * images de formes variées : carrée, paysage, portrait, panorama, minuscule.
 *
 * L'égalité stricte n'a pas de sens : PIL et sharp ne rééchantillonnent pas
 * exactement pareil. Ce qu'on vérifie, c'est tout le reste — l'ordre des
 * canaux, la disposition en plans, le cadrage centré, la normalisation. Une
 * erreur là-dessus déplace les valeurs d'un ordre de grandeur, pas d'un
 * centième.
 *
 * Le dossier doit contenir `images/` et `attendu_image.json`, produits par
 * `ref_image.py` (voir clip-fixtures/LISEZMOI.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_SIZE, imageTensor } from '../server/src/clip/preprocess.js';

const dir = process.argv[2] ?? path.join(process.cwd(), 'clip-fixtures');
const refFile = path.join(dir, 'attendu_image.json');

if (!fs.existsSync(refFile)) {
  console.log(`Pas de référence dans ${dir} — rien à comparer.`);
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (nom: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK   ' : 'ECHEC'} ${nom}${extra ? '  ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};

const attendu = JSON.parse(fs.readFileSync(refFile, 'utf8')) as Record<string, number[]>;
const N = IMAGE_SIZE * IMAGE_SIZE;

console.log('=== face a la chaine officielle de PyTorch ===');
for (const [nom, ref] of Object.entries(attendu)) {
  const buf = fs.readFileSync(path.join(dir, 'images', nom));
  const mien = await imageTensor(buf);

  if (mien.length !== ref.length) {
    ok(nom, false, `${mien.length} valeurs au lieu de ${ref.length}`);
    continue;
  }

  let somme = 0;
  let pire = 0;
  for (let i = 0; i < ref.length; i++) {
    const d = Math.abs(mien[i] - ref[i]);
    somme += d;
    if (d > pire) pire = d;
  }
  const moyenne = somme / ref.length;

  // Les valeurs normalisées vont environ de -1,8 à +2,2 : un écart moyen de
  // quelques centièmes reste du bruit de rééchantillonnage. Une erreur de canal
  // ou de normalisation en produirait dix à cinquante fois plus.
  //
  // C'est à l'agrandissement que les deux rééchantillonneurs divergent le plus,
  // d'où le seuil plus large pour une image plus petite que 224 — en pratique
  // Photon part de la vignette de 960 px, donc réduit presque toujours.
  const seuil = nom.includes('petit') ? 0.06 : 0.02;
  ok(nom, moyenne < seuil, `ecart moyen ${moyenne.toFixed(4)}, pire ${pire.toFixed(3)}`);
}

console.log('\n=== forme et disposition du tenseur ===');
{
  const buf = fs.readFileSync(path.join(dir, 'images', 'paysage.png'));
  const t = await imageTensor(buf);
  ok('3 × 224 × 224 valeurs', t.length === 3 * N, String(t.length));

  // Les trois plans doivent différer : s'ils sont identiques, c'est qu'on a
  // recopié le même canal trois fois — une erreur qui passerait inaperçue.
  const plan = (k: number): number => {
    let s = 0;
    for (let i = 0; i < N; i++) s += t[k * N + i];
    return s / N;
  };
  const [r, v, b] = [plan(0), plan(1), plan(2)];
  ok('les trois canaux sont distincts', r !== v && v !== b,
     `R ${r.toFixed(3)}  V ${v.toFixed(3)}  B ${b.toFixed(3)}`);

  // Chaque canal doit correspondre au sien dans la référence : un rouge et un
  // bleu intervertis donnent des moyennes très differentes.
  const ref = attendu['paysage.png'];
  const planRef = (k: number): number => {
    let s = 0;
    for (let i = 0; i < N; i++) s += ref[k * N + i];
    return s / N;
  };
  ok('le rouge est bien le rouge', Math.abs(r - planRef(0)) < 0.05,
     `${r.toFixed(3)} contre ${planRef(0).toFixed(3)}`);
  ok('le bleu est bien le bleu', Math.abs(b - planRef(2)) < 0.05,
     `${b.toFixed(3)} contre ${planRef(2).toFixed(3)}`);
  // `Math.min(...t)` sur 150 528 valeurs fait deborder la pile des appels.
  let bas = Infinity;
  let haut = -Infinity;
  for (const v of t) {
    if (v < bas) bas = v;
    if (v > haut) haut = v;
  }
  ok('les valeurs sont bien normalisees', bas > -2.5 && haut < 2.8,
     `de ${bas.toFixed(2)} a ${haut.toFixed(2)}`);
}

console.log(`\n${pass} reussites, ${fail} echec${fail === 1 ? '' : 's'}`);
process.exit(fail === 0 ? 0 : 1);
