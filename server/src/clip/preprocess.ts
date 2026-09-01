/**
 * Préparation d'une image pour CLIP.
 *
 * Le modèle attend toujours la même chose : 224×224 pixels, trois canaux dans
 * l'ordre rouge-vert-bleu, valeurs centrées et réduites selon des constantes
 * fixées à l'entraînement. Se tromper d'un cheveu ici — un canal inversé, une
 * moyenne oubliée — ne provoque aucune erreur : les recherches deviennent
 * simplement absurdes, ce qui est bien pire.
 *
 * D'où la vérification : `npm run test:clip-image` compare ce que produit ce
 * fichier à la chaîne officielle de PyTorch, sur des images fabriquées exprès.
 */
import sharp from 'sharp';

/** Côté de l'image attendue par CLIP ViT-B/32. */
export const IMAGE_SIZE = 224;

/**
 * Moyennes et écarts-types utilisés à l'entraînement de CLIP. Ce ne sont pas
 * ceux d'ImageNet, qui traînent partout et se ressemblent assez pour qu'on les
 * confonde : ceux-ci viennent de `clip/clip.py`.
 */
const MEAN = [0.48145466, 0.4578275, 0.40821073];
const STD = [0.26862954, 0.26130258, 0.27577711];

/**
 * Transforme une image en tenseur prêt pour le modèle : un seul lot, trois
 * canaux, 224 lignes, 224 colonnes — disposition « NCHW », c'est-à-dire tout le
 * rouge, puis tout le vert, puis tout le bleu.
 *
 * Le cadrage reprend celui de PyTorch : le plus petit côté est ramené à 224,
 * puis on découpe un carré au centre. Une photo panoramique perd donc ses
 * bords, exactement comme à l'entraînement du modèle.
 */
export async function imageTensor(source: Buffer): Promise<Float32Array> {
  const pixels = await sharp(source, { failOn: 'none' })
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'cover', position: 'centre', kernel: 'cubic' })
    .removeAlpha()
    .toColourspace('srgb')
    .raw()
    .toBuffer();

  const n = IMAGE_SIZE * IMAGE_SIZE;
  if (pixels.length !== n * 3) {
    throw new Error(`image inattendue : ${pixels.length} octets au lieu de ${n * 3}`);
  }

  // Les pixels arrivent entrelacés (RVB, RVB, …), le modèle les veut par plan.
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = (pixels[i * 3] / 255 - MEAN[0]) / STD[0];
    out[n + i] = (pixels[i * 3 + 1] / 255 - MEAN[1]) / STD[1];
    out[2 * n + i] = (pixels[i * 3 + 2] / 255 - MEAN[2]) / STD[2];
  }
  return out;
}
