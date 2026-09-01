/**
 * Vérification du rangement et du classement des vecteurs CLIP.
 * `npm run test:clip-search`
 *
 * Le modèle lui-même n'est pas nécessaire : on fabrique des vecteurs dont on
 * connaît la réponse, et on vérifie que l'aller-retour en base est exact et que
 * le classement met bien les plus proches en tête. C'est là que se logent les
 * fautes silencieuses — un octet mal lu, un tri à l'envers — qui donneraient
 * des résultats plausibles mais faux.
 */
import { EMBED_DIM } from '../server/src/clip/model.js';
import { dot, packEmbedding, unpackEmbedding } from '../server/src/clip/search.js';

let pass = 0;
let fail = 0;
const ok = (nom: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK   ' : 'ECHEC'} ${nom}${extra ? '  ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};

/** Un vecteur quelconque, ramené à une longueur de 1. */
function vecteur(graine: number): Float32Array {
  const v = new Float32Array(EMBED_DIM);
  let x = graine;
  for (let i = 0; i < EMBED_DIM; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    v[i] = x / 1073741824 - 1;
  }
  let s = 0;
  for (const y of v) s += y * y;
  const n = Math.sqrt(s);
  for (let i = 0; i < EMBED_DIM; i++) v[i] /= n;
  return v;
}

console.log('=== aller-retour en base ===');
{
  const v = vecteur(7);
  const paquet = packEmbedding(v);
  ok('2 048 octets pour 512 nombres', paquet.length === EMBED_DIM * 4, `${paquet.length}`);

  const relu = unpackEmbedding(paquet);
  let pire = 0;
  for (let i = 0; i < EMBED_DIM; i++) pire = Math.max(pire, Math.abs(v[i] - relu[i]));
  ok('rien ne se perd au passage', pire === 0, `ecart maximal ${pire}`);

  // Le tampon rendu par SQLite est reutilise d'une ligne a l'autre : si on ne
  // recopiait pas, tous les vecteurs finiraient identiques au dernier lu.
  const partage = Buffer.concat([packEmbedding(vecteur(1)), packEmbedding(vecteur(2))]);
  const a = unpackEmbedding(partage.subarray(0, EMBED_DIM * 4));
  const b = unpackEmbedding(partage.subarray(EMBED_DIM * 4));
  ok('deux vecteurs voisins restent distincts', dot(a, b) < 0.5, `produit ${dot(a, b).toFixed(3)}`);
}

console.log('\n=== produit scalaire ===');
{
  const v = vecteur(11);
  ok('un vecteur contre lui-meme vaut 1', Math.abs(dot(v, v) - 1) < 1e-5, dot(v, v).toFixed(6));

  const oppose = Float32Array.from(v, (x) => -x);
  ok('son oppose vaut -1', Math.abs(dot(v, oppose) + 1) < 1e-5, dot(v, oppose).toFixed(6));

  // Deux vecteurs perpendiculaires, construits pour l'occasion.
  const a = new Float32Array(EMBED_DIM);
  const b = new Float32Array(EMBED_DIM);
  a[0] = 1;
  b[1] = 1;
  ok('deux perpendiculaires valent 0', dot(a, b) === 0);

  ok('le produit est symetrique', dot(v, oppose) === dot(oppose, v));
}

console.log('\n=== classement ===');
{
  // Une cible, puis des vecteurs de plus en plus eloignes d'elle.
  const cible = vecteur(3);
  const bruit = vecteur(99);
  const melange = (part: number): Float32Array => {
    const v = new Float32Array(EMBED_DIM);
    for (let i = 0; i < EMBED_DIM; i++) v[i] = cible[i] * (1 - part) + bruit[i] * part;
    let s = 0;
    for (const y of v) s += y * y;
    const n = Math.sqrt(s);
    for (let i = 0; i < EMBED_DIM; i++) v[i] /= n;
    return v;
  };

  const parts = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const scores = parts.map((p) => dot(cible, melange(p)));
  console.log('     ressemblance selon la part de bruit :',
    scores.map((s) => s.toFixed(3)).join(' > '));
  ok('plus il y a de bruit, moins ca ressemble',
     scores.every((s, i) => i === 0 || s < scores[i - 1]));
  ok('la cible pure est en tete', scores[0] > 0.99);
}

console.log('\n=== robustesse ===');
{
  const v = vecteur(5);
  const court = new Float32Array(8);
  // Un vecteur tronque ne doit pas faire planter la comparaison : on veut une
  // valeur, meme mediocre, plutot qu'une exception au milieu d'une recherche.
  ok('un vecteur trop court ne plante pas', Number.isFinite(dot(v, court)));
  ok('un vecteur nul donne 0', dot(v, new Float32Array(EMBED_DIM)) === 0);
}

console.log(`\n${pass} reussites, ${fail} echec${fail === 1 ? '' : 's'}`);
process.exit(fail === 0 ? 0 : 1);
