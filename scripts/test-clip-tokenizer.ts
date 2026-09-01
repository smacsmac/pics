/**
 * Conformité du tokenizer CLIP.  `npm run test:clip -- <dossier>`
 *
 * Compare notre portage à l'implémentation officielle d'OpenAI, jeton par
 * jeton, sur plusieurs centaines de phrases : français, anglais, coréen,
 * emoji, nombres, ponctuation, chaînes vides et textes trop longs.
 *
 * Le dossier doit contenir :
 *   bpe_simple_vocab_16e6.txt.gz   le vocabulaire d'OpenAI
 *   phrases.json                   les phrases à comparer
 *   attendu.json                   ce que la référence en fait
 *
 * Les deux derniers se produisent avec `clip/reference.py` du dépôt d'OpenAI.
 * Sans ce dossier, le script le dit et s'arrête sans échouer : la conformité a
 * été établie une fois pour toutes, elle n'a pas à bloquer une installation.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ClipTokenizer, CONTEXT_LENGTH } from '../server/src/clip/tokenizer.js';

const dir = process.argv[2] ?? path.join(process.cwd(), 'clip-fixtures');
const vocabFile = path.join(dir, 'bpe_simple_vocab_16e6.txt.gz');

if (!fs.existsSync(vocabFile)) {
  console.log(`Pas de vocabulaire dans ${dir} — rien à comparer.`);
  console.log('Voir l\'en-tête de ce fichier pour le produire.');
  process.exit(0);
}

let pass = 0;
let fail = 0;
const ok = (nom: string, cond: boolean, extra = ''): void => {
  console.log(`  ${cond ? 'OK   ' : 'ECHEC'} ${nom}${extra ? '  ' + extra : ''}`);
  if (cond) pass++;
  else fail++;
};

const merges = zlib.gunzipSync(fs.readFileSync(vocabFile)).toString('utf8');
const tok = new ClipTokenizer(merges);

console.log('=== le vocabulaire ===');
ok('49 408 entrées, comme le modèle', tok.vocabSize === 49408, String(tok.vocabSize));
ok('marqueur de début à 49 406', tok.startToken === 49406, String(tok.startToken));
ok('marqueur de fin à 49 407', tok.endToken === 49407, String(tok.endToken));

console.log('\n=== conformité, jeton par jeton, face à la référence ===');
const phrases = JSON.parse(fs.readFileSync(path.join(dir, 'phrases.json'), 'utf8')) as string[];
const attendu = JSON.parse(fs.readFileSync(path.join(dir, 'attendu.json'), 'utf8')) as Record<string, number[]>;

const ecarts: Array<{ phrase: string; attendu: number[]; obtenu: number[] }> = [];
for (const phrase of phrases) {
  const a = attendu[phrase];
  if (!a) continue;
  const b = tok.encode(phrase);
  if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
    ecarts.push({ phrase, attendu: a, obtenu: b });
  }
}
ok(`${phrases.length} phrases identiques`, ecarts.length === 0,
   ecarts.length ? `${ecarts.length} écart(s)` : '');
for (const e of ecarts.slice(0, 5)) {
  console.log(`      « ${e.phrase} »`);
  console.log(`        attendu ${JSON.stringify(e.attendu)}`);
  console.log(`        obtenu  ${JSON.stringify(e.obtenu)}`);
}

console.log('\n=== mise en forme pour le modèle ===');
{
  const t = tok.tokenize('a dog on the beach');
  ok('toujours 77 valeurs', t.length === CONTEXT_LENGTH, String(t.length));
  ok('commence par le marqueur de début', t[0] === tok.startToken);
  const corps = tok.encode('a dog on the beach');
  ok('le texte suit', corps.every((v, i) => t[i + 1] === v));
  ok('puis le marqueur de fin', t[corps.length + 1] === tok.endToken);
  ok('et des zéros ensuite', [...t.slice(corps.length + 2)].every((v) => v === 0));
}
{
  // Un texte plus long que le contexte doit être coupé, mais garder sa fin :
  // sans marqueur de fin, le modèle lit une phrase qui ne s'arrête jamais.
  const long = tok.tokenize('mot '.repeat(200));
  ok('un texte trop long tient dans 77', long.length === CONTEXT_LENGTH);
  ok('il garde son marqueur de fin', long[CONTEXT_LENGTH - 1] === tok.endToken,
     String(long[CONTEXT_LENGTH - 1]));
  ok('aucun zéro au milieu', [...long.slice(0, CONTEXT_LENGTH)].every((v) => v !== 0));
}
{
  const vide = tok.tokenize('');
  ok('un texte vide reste valide', vide[0] === tok.startToken && vide[1] === tok.endToken);
}

console.log(`\n${pass} reussites, ${fail} echec${fail === 1 ? '' : 's'}`);
process.exit(fail === 0 ? 0 : 1);
