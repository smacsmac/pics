/**
 * Le modèle CLIP : photos et phrases projetées dans un même espace, où deux
 * choses qui se ressemblent sont proches. C'est ce qui permet de taper
 * « chien sur la plage » et de retrouver la photo, sans l'avoir taguée.
 *
 * Trois précautions gouvernent ce fichier.
 *
 * **Tout est facultatif.** `onnxruntime-node` n'est pas une dépendance du
 * projet : on l'importe à l'exécution, et son absence n'empêche rien d'autre de
 * fonctionner. Photon marche entièrement sans.
 *
 * **Tout est hors ligne, sauf une fois.** Le modèle se télécharge une seule
 * fois, puis vit dans le dossier de données. Ensuite, plus rien ne sort.
 *
 * **Rien n'est deviné en silence.** Les noms des entrées et des sorties d'un
 * modèle ONNX varient d'un export à l'autre. Plutôt que de parier sur les uns
 * ou les autres, on lit ce que le fichier déclare et on s'y adapte ; si rien ne
 * correspond, on le dit clairement au lieu de renvoyer des chiffres qui n'ont
 * aucun sens. Une recherche qui répond n'importe quoi est bien pire qu'une
 * recherche qui explique pourquoi elle ne marche pas.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR } from '../paths.js';
import { imageTensor, IMAGE_SIZE } from './preprocess.js';
import { ClipTokenizer, CONTEXT_LENGTH } from './tokenizer.js';

/** Dimension des vecteurs de CLIP ViT-B/32. */
export const EMBED_DIM = 512;

export const CLIP_DIR = path.join(DATA_DIR, 'clip');
const MODEL_FILE = path.join(CLIP_DIR, 'model.onnx');
const VOCAB_FILE = path.join(CLIP_DIR, 'bpe_simple_vocab_16e6.txt.gz');

/**
 * D'où viennent les fichiers. Modifiables par variables d'environnement : si un
 * dépôt se réorganise, on n'a pas à recompiler pour aller chercher ailleurs.
 */
const MODEL_URL =
  process.env.PHOTON_CLIP_MODEL_URL ??
  'https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main/onnx/model_quantized.onnx';
const VOCAB_URL =
  process.env.PHOTON_CLIP_VOCAB_URL ??
  'https://raw.githubusercontent.com/openai/CLIP/main/clip/bpe_simple_vocab_16e6.txt.gz';

export interface ClipStatus {
  /** `onnxruntime-node` est installé. */
  runtime: boolean;
  /** Les fichiers du modèle sont là. */
  files: boolean;
  /** Le modèle a été chargé et ses entrées reconnues. */
  ready: boolean;
  /** Téléchargement en cours, de 0 à 1. */
  downloading: number | null;
  /** Ce qui cloche, en clair. */
  error: string | null;
  /** Ce que le fichier ONNX déclare, pour diagnostiquer un modèle inattendu. */
  inputs: string[];
  outputs: string[];
}

const status: ClipStatus = {
  runtime: false, files: false, ready: false, downloading: null,
  error: null, inputs: [], outputs: [],
};

export function clipStatus(): ClipStatus {
  status.files = fs.existsSync(MODEL_FILE) && fs.existsSync(VOCAB_FILE);
  return { ...status };
}

// --------------------------------------------------------------- chargement

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ort = any;
type Session = any;

let ort: Ort | null = null;
let session: Session | null = null;
let tokenizer: ClipTokenizer | null = null;
let loading: Promise<boolean> | null = null;

/** Noms retenus après lecture du modèle. */
const names = {
  pixels: '',
  ids: '',
  mask: '',
  imageOut: '',
  textOut: '',
};

/** Les identifiants de jetons sont tantôt en 64 bits, tantôt en 32. */
let idsAsInt64 = true;

/** Cherche parmi les noms déclarés le premier qui corresponde. */
function pick(declared: string[], candidates: string[]): string {
  for (const c of candidates) if (declared.includes(c)) return c;
  return '';
}

async function loadRuntime(): Promise<Ort | null> {
  if (ort) return ort;
  try {
    // Import dynamique, par une variable : le paquet n'est pas une dépendance du
    // projet, et TypeScript ne doit pas exiger ses types à la compilation. Son
    // absence à l'exécution reste sans conséquence.
    const nom = 'onnxruntime-node';
    ort = (await import(nom)) as Ort;
    status.runtime = true;
    return ort;
  } catch {
    status.runtime = false;
    status.error = 'onnxruntime-node absent';
    return null;
  }
}

/**
 * Charge le modèle et reconnaît ses entrées et ses sorties. Une seule fois : les
 * appels suivants attendent la même promesse.
 */
export function load(): Promise<boolean> {
  if (loading) return loading;
  loading = (async () => {
    const runtime = await loadRuntime();
    if (!runtime) return false;

    if (!fs.existsSync(MODEL_FILE) || !fs.existsSync(VOCAB_FILE)) {
      status.error = 'modèle non installé';
      return false;
    }

    try {
      session = await runtime.InferenceSession.create(MODEL_FILE);
      const declaredIn: string[] = session.inputNames ?? [];
      const declaredOut: string[] = session.outputNames ?? [];
      status.inputs = declaredIn;
      status.outputs = declaredOut;

      names.pixels = pick(declaredIn, ['pixel_values', 'input', 'images', 'image']);
      names.ids = pick(declaredIn, ['input_ids', 'text', 'tokens']);
      names.mask = pick(declaredIn, ['attention_mask']);
      names.imageOut = pick(declaredOut, ['image_embeds', 'image_embeddings', 'img_emb']);
      names.textOut = pick(declaredOut, ['text_embeds', 'text_embeddings', 'txt_emb']);

      // Sans projection commune, images et textes ne vivent pas dans le même
      // espace et les comparer n'a aucun sens. Mieux vaut refuser franchement.
      const manque: string[] = [];
      if (!names.pixels) manque.push('entrée image');
      if (!names.ids) manque.push('entrée texte');
      if (!names.imageOut) manque.push('sortie image_embeds');
      if (!names.textOut) manque.push('sortie text_embeds');
      if (manque.length > 0) {
        status.error =
          `modèle inattendu — il manque : ${manque.join(', ')}. ` +
          `Entrées déclarées : ${declaredIn.join(', ') || '(aucune)'}. ` +
          `Sorties : ${declaredOut.join(', ') || '(aucune)'}.`;
        session = null;
        return false;
      }

      const merges = zlib.gunzipSync(fs.readFileSync(VOCAB_FILE)).toString('utf8');
      tokenizer = new ClipTokenizer(merges);
      if (tokenizer.vocabSize !== 49408) {
        status.error = `vocabulaire inattendu : ${tokenizer.vocabSize} entrées au lieu de 49 408`;
        session = null;
        return false;
      }

      status.ready = true;
      status.error = null;
      return true;
    } catch (err) {
      status.error = err instanceof Error ? err.message : String(err);
      session = null;
      return false;
    }
  })();
  return loading;
}

/** Oublie ce qui est chargé, pour recharger après une installation. */
export function reset(): void {
  session = null;
  tokenizer = null;
  loading = null;
  status.ready = false;
  status.inputs = [];
  status.outputs = [];
}

// ------------------------------------------------------------------ calculs

/** Ramène un vecteur à une longueur de 1 : la similarité devient un simple produit. */
function normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const n = Math.sqrt(sum);
  if (n === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

/** Les jetons d'un texte, dans le type qu'attend le modèle. */
function tokensTensor(text: string): { ids: unknown; mask: unknown } {
  const tokens = tokenizer!.tokenize(text);
  const mask = new Array(CONTEXT_LENGTH).fill(0);
  // Le masque couvre le texte réel, marqueurs compris : au-delà, ce ne sont que
  // des zéros de remplissage, que le modèle doit ignorer.
  for (let i = 0; i < CONTEXT_LENGTH; i++) {
    mask[i] = tokens[i] !== 0 || i === 0 ? 1 : 0;
    if (tokens[i] === tokenizer!.endToken) break;
  }
  const upto = mask.lastIndexOf(1);
  for (let i = 0; i <= upto; i++) mask[i] = 1;

  const dims = [1, CONTEXT_LENGTH];
  if (idsAsInt64) {
    return {
      ids: new ort.Tensor('int64', BigInt64Array.from(tokens, (t) => BigInt(t)), dims),
      mask: new ort.Tensor('int64', BigInt64Array.from(mask, (m) => BigInt(m)), dims),
    };
  }
  return {
    ids: new ort.Tensor('int32', Int32Array.from(tokens), dims),
    mask: new ort.Tensor('int32', Int32Array.from(mask), dims),
  };
}

/** Une image neutre, pour les modèles qui exigent les deux entrées à la fois. */
function blankImage(): unknown {
  return new ort.Tensor('float32', new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE), [1, 3, IMAGE_SIZE, IMAGE_SIZE]);
}

async function run(feeds: Record<string, unknown>, want: string): Promise<Float32Array> {
  try {
    const out = await session.run(feeds);
    const tensor = out[want];
    if (!tensor) throw new Error(`sortie « ${want} » absente`);
    return normalize(Float32Array.from(tensor.data as Float32Array));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Un export sur deux attend des entiers 32 bits plutôt que 64. On bascule
    // une fois et on réessaie, plutôt que d'échouer sur un détail de format.
    if (idsAsInt64 && /int32|tensor\(int|type/i.test(message)) {
      idsAsInt64 = false;
      throw new Error(`__retry__:${message}`);
    }
    throw err;
  }
}

/** Le vecteur d'une image. Null si le modèle n'est pas prêt. */
export async function embedImage(source: Buffer): Promise<Float32Array | null> {
  if (!(await load())) return null;
  const pixels = await imageTensor(source);

  const build = (): Record<string, unknown> => {
    const feeds: Record<string, unknown> = {
      [names.pixels]: new ort.Tensor('float32', pixels, [1, 3, IMAGE_SIZE, IMAGE_SIZE]),
    };
    // Le modèle complet réclame aussi un texte : on lui donne une phrase vide,
    // dont on ignorera la sortie.
    const { ids, mask } = tokensTensor('');
    feeds[names.ids] = ids;
    if (names.mask) feeds[names.mask] = mask;
    return feeds;
  };

  try {
    return await run(build(), names.imageOut);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('__retry__:')) {
      return run(build(), names.imageOut);
    }
    throw err;
  }
}

/** Le vecteur d'une phrase. Null si le modèle n'est pas prêt. */
export async function embedText(text: string): Promise<Float32Array | null> {
  if (!(await load())) return null;

  const build = (): Record<string, unknown> => {
    const { ids, mask } = tokensTensor(text);
    const feeds: Record<string, unknown> = { [names.ids]: ids };
    if (names.mask) feeds[names.mask] = mask;
    feeds[names.pixels] = blankImage();
    return feeds;
  };

  try {
    return await run(build(), names.textOut);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('__retry__:')) {
      return run(build(), names.textOut);
    }
    throw err;
  }
}

// ------------------------------------------------------------ installation

async function fetchTo(url: string, dest: string, onProgress: (ratio: number) => void): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${url} → HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);

  // On écrit à côté, puis on renomme : un téléchargement interrompu ne laisse
  // pas un fichier tronqué qui passerait pour un modèle valide.
  const tmp = `${dest}.part`;
  const out = fs.createWriteStream(tmp);
  let done = 0;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    done += chunk.length;
    if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
    if (total > 0) onProgress(done / total);
  }
  await new Promise<void>((r) => out.end(() => r()));
  await fs.promises.rename(tmp, dest);
}

/**
 * Installe le modèle. C'est le seul moment où Photon touche à Internet, et il
 * faut le demander explicitement.
 */
export async function install(): Promise<{ ok: boolean; error: string | null }> {
  if (status.downloading !== null) return { ok: false, error: 'déjà en cours' };
  await fs.promises.mkdir(CLIP_DIR, { recursive: true });
  status.downloading = 0;
  status.error = null;

  try {
    // Le vocabulaire d'abord : il est petit, et son échec dit tout de suite si
    // le réseau est le problème.
    if (!fs.existsSync(VOCAB_FILE)) {
      await fetchTo(VOCAB_URL, VOCAB_FILE, (r) => {
        status.downloading = r * 0.02;
      });
    }
    if (!fs.existsSync(MODEL_FILE)) {
      await fetchTo(MODEL_URL, MODEL_FILE, (r) => {
        status.downloading = 0.02 + r * 0.98;
      });
    }
    status.downloading = null;
    reset();
    const ok = await load();
    return { ok, error: ok ? null : status.error };
  } catch (err) {
    status.downloading = null;
    status.error = err instanceof Error ? err.message : String(err);
    // On ne garde pas de moitié de fichier : elle empêcherait de réessayer.
    for (const f of [`${MODEL_FILE}.part`, `${VOCAB_FILE}.part`]) {
      await fs.promises.rm(f, { force: true }).catch(() => {});
    }
    return { ok: false, error: status.error };
  }
}

/** Efface le modèle. Rend une bonne part de gigaoctet, et se refait plus tard. */
export async function uninstall(): Promise<void> {
  reset();
  await fs.promises.rm(CLIP_DIR, { recursive: true, force: true }).catch(() => {});
  status.files = false;
  status.error = null;
}
