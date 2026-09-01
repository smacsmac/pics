/**
 * Contrôle du modèle CLIP installé.  `npm run test:clip-model`
 *
 * À lancer **après** avoir installé le modèle depuis Photon. C'est le contrôle
 * que je n'ai pas pu faire moi-même : l'environnement où Photon a été écrit ne
 * peut joindre ni le dépôt du modèle ni celui d'`onnxruntime-node`. Tout le
 * reste de la recherche par description est vérifié — le découpage du texte
 * face à l'implémentation d'OpenAI, la préparation des images face à PyTorch,
 * l'algèbre du classement — mais l'inférence elle-même ne l'a jamais été.
 *
 * Ce script s'en charge, et il n'a besoin d'aucune photo : il interroge le
 * modèle sur des phrases dont on connaît le rapport. Si « un chien » se
 * rapproche davantage de « un chiot » que d'« un gratte-ciel », c'est que le
 * modèle, le vocabulaire, le découpage et la projection fonctionnent ensemble.
 * Sinon, quelque chose est cassé, et mieux vaut le savoir tout de suite qu'au
 * milieu d'une recherche qui répond n'importe quoi.
 */
import { clipStatus, embedImage, embedText, load } from '../server/src/clip/model.js';

let pass = 0;
let fail = 0;
const ok = (nom: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK   ' : 'ECHEC'} ${nom}${extra ? '  ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};

console.log('=== etat ===');
const avant = clipStatus();
console.log(`  onnxruntime-node : ${avant.runtime ? 'present' : 'absent (sera teste au chargement)'}`);
console.log(`  fichiers         : ${avant.files ? 'presents' : 'absents'}`);

if (!avant.files) {
  console.log('\nLe modele n est pas installe.');
  console.log('Ouvrez Photon → Parametres → Recherche par description → Installer,');
  console.log('puis relancez ce script.');
  process.exit(0);
}

const pret = await load();
const etat = clipStatus();
console.log(`  entrees declarees : ${etat.inputs.join(', ') || '(aucune)'}`);
console.log(`  sorties declarees : ${etat.outputs.join(', ') || '(aucune)'}`);
if (!pret) {
  console.log(`\n  ECHEC le modele ne charge pas : ${etat.error}`);
  process.exit(1);
}
ok('le modele charge', true);

console.log('\n=== forme des vecteurs ===');
const chien = await embedText('a photo of a dog');
if (!chien) {
  console.log('  ECHEC aucun vecteur produit');
  process.exit(1);
}
ok('512 nombres', chien.length === 512, String(chien.length));
{
  let s = 0;
  for (const x of chien) s += x * x;
  ok('de longueur 1', Math.abs(Math.sqrt(s) - 1) < 1e-4, Math.sqrt(s).toFixed(6));
  ok('aucune valeur aberrante', chien.every((x) => Number.isFinite(x)));
  ok('le vecteur n est pas nul', chien.some((x) => x !== 0));
}

const produit = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

console.log('\n=== le sens des mots ===');
{
  const paires: Array<[string, string, string]> = [
    ['a photo of a dog', 'a photo of a puppy', 'a photo of a skyscraper'],
    ['a beach at sunset', 'the sea in the evening', 'a computer keyboard'],
    ['a birthday cake', 'a cake with candles', 'a snowy mountain'],
    ['un chien sur la plage', 'a dog at the beach', 'a page of source code'],
    ['snow', 'winter landscape', 'a bowl of spaghetti'],
  ];

  for (const [base, proche, loin] of paires) {
    const [a, b, c] = await Promise.all([embedText(base), embedText(proche), embedText(loin)]);
    if (!a || !b || !c) {
      ok(base, false, 'vecteur manquant');
      continue;
    }
    const sProche = produit(a, b);
    const sLoin = produit(a, c);
    ok(`« ${base} »`, sProche > sLoin,
       `proche ${sProche.toFixed(3)} contre lointain ${sLoin.toFixed(3)}`);
  }
}

console.log('\n=== images et textes se parlent ===');
{
  // Deux images unies, sans rien reconnaissable dessus : on ne demande pas au
  // modele de les nommer, seulement de placer leurs vecteurs dans le meme
  // espace que ceux des phrases. Un ecart de similarite proche de zero sur
  // toutes les phrases trahirait une projection manquante.
  const sharp = (await import('sharp')).default;
  const vert = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 30, g: 130, b: 40 } } })
    .jpeg().toBuffer();
  const bleu = await sharp({ create: { width: 320, height: 320, channels: 3, background: { r: 30, g: 90, b: 200 } } })
    .jpeg().toBuffer();

  const [vImg, bImg] = await Promise.all([embedImage(vert), embedImage(bleu)]);
  if (!vImg || !bImg) {
    ok('les images produisent un vecteur', false);
  } else {
    ok('une image donne 512 nombres', vImg.length === 512, String(vImg.length));
    let s = 0;
    for (const x of vImg) s += x * x;
    ok('de longueur 1', Math.abs(Math.sqrt(s) - 1) < 1e-4, Math.sqrt(s).toFixed(6));
    ok('deux couleurs donnent deux vecteurs differents', produit(vImg, bImg) < 0.999,
       produit(vImg, bImg).toFixed(4));

    const tVert = await embedText('a solid green image');
    const tBleu = await embedText('a solid blue image');
    if (tVert && tBleu) {
      const bonVert = produit(vImg, tVert) > produit(vImg, tBleu);
      const bonBleu = produit(bImg, tBleu) > produit(bImg, tVert);
      console.log(`     vert  : « vert » ${produit(vImg, tVert).toFixed(3)}  « bleu » ${produit(vImg, tBleu).toFixed(3)}`);
      console.log(`     bleu  : « vert » ${produit(bImg, tVert).toFixed(3)}  « bleu » ${produit(bImg, tBleu).toFixed(3)}`);
      ok('le vert est reconnu comme vert', bonVert);
      ok('le bleu est reconnu comme bleu', bonBleu);
    }
  }
}

console.log(`\n${pass} reussites, ${fail} echec${fail === 1 ? '' : 's'}`);
if (fail > 0) {
  console.log('\nSi les phrases ne se classent pas correctement, le modele telecharge');
  console.log('n est probablement pas celui attendu. Les entrees et sorties declarees');
  console.log('sont affichees plus haut ; PHOTON_CLIP_MODEL_URL permet d en essayer un autre.');
}
process.exit(fail === 0 ? 0 : 1);
