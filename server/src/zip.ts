/**
 * Écriture d'archives ZIP au fil de l'eau, sans dépendance.
 *
 * Les photos et les vidéos sont déjà compressées : on les range telles quelles
 * (méthode « stored »), ce qui évite de recompresser pour rien et permet de
 * commencer à envoyer sans connaître la taille finale.
 *
 * Comme les tailles ne sont connues qu'après avoir lu chaque fichier, on utilise
 * les « descripteurs de données » (bit 3 des drapeaux) : l'en-tête local est
 * écrit avec des zéros, les vraies valeurs suivent le contenu. C'est ce que fait
 * tout ZIP produit en flux.
 *
 * Zip64 est activé par entrée dès qu'un fichier dépasse 4 Gio, et sur l'archive
 * dès qu'elle les dépasse — sinon une bibliothèque familiale un peu fournie
 * produirait un fichier corrompu au-delà de cette limite.
 */
import fs from 'node:fs';
import { PassThrough, type Readable } from 'node:stream';

const U32_MAX = 0xffff_ffff;

/** Table CRC-32 (polynôme 0xEDB88320), calculée une fois. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return table;
})();

function crc32(chunk: Buffer, seed: number): number {
  let c = seed ^ -1;
  for (let i = 0; i < chunk.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ chunk[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

export interface ZipEntry {
  /** Chemin du fichier sur le disque. */
  path: string;
  /** Nom sous lequel il apparaît dans l'archive. */
  name: string;
  /** Date de dernière modification, pour l'horodatage de l'entrée. */
  mtime: Date;
}

interface Written {
  name: Buffer;
  offset: number;
  crc: number;
  size: number;
  dosTime: number;
  dosDate: number;
}

/** MS-DOS ne code que les années 1980 à 2107, par pas de deux secondes. */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function localHeader(name: Buffer, stamp: { time: number; date: number }): Buffer {
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x0403_4b50, 0);
  head.writeUInt16LE(45, 4); // version minimale : 4.5, pour zip64
  head.writeUInt16LE(0x0808, 6); // bit 3 : tailles dans le descripteur ; bit 11 : noms UTF-8
  head.writeUInt16LE(0, 8); // méthode : stocké
  head.writeUInt16LE(stamp.time, 10);
  head.writeUInt16LE(stamp.date, 12);
  head.writeUInt32LE(0, 14); // CRC, inconnu à ce stade
  head.writeUInt32LE(0, 18); // taille compressée, idem
  head.writeUInt32LE(0, 22); // taille réelle, idem
  head.writeUInt16LE(name.length, 26);
  head.writeUInt16LE(0, 28);
  return Buffer.concat([head, name]);
}

/** Descripteur qui suit le contenu : c'est là que vivent les vraies tailles. */
function dataDescriptor(crc: number, size: number): Buffer {
  // Au-delà de 4 Gio, les tailles passent sur 8 octets (zip64).
  if (size > U32_MAX) {
    const d = Buffer.alloc(24);
    d.writeUInt32LE(0x0807_4b50, 0);
    d.writeUInt32LE(crc, 4);
    d.writeBigUInt64LE(BigInt(size), 8);
    d.writeBigUInt64LE(BigInt(size), 16);
    return d;
  }
  const d = Buffer.alloc(16);
  d.writeUInt32LE(0x0807_4b50, 0);
  d.writeUInt32LE(crc, 4);
  d.writeUInt32LE(size, 8);
  d.writeUInt32LE(size, 12);
  return d;
}

function centralEntry(e: Written): Buffer {
  const big = e.size > U32_MAX || e.offset > U32_MAX;
  // L'extra zip64 ne porte que les champs réellement mis à 0xFFFFFFFF.
  const extra = big ? Buffer.alloc(4 + 24) : Buffer.alloc(0);
  if (big) {
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(e.size), 4);
    extra.writeBigUInt64LE(BigInt(e.size), 12);
    extra.writeBigUInt64LE(BigInt(e.offset), 20);
  }

  const head = Buffer.alloc(46);
  head.writeUInt32LE(0x0201_4b50, 0);
  head.writeUInt16LE(45, 4); // fabriqué par
  head.writeUInt16LE(45, 6); // version minimale
  head.writeUInt16LE(0x0808, 8);
  head.writeUInt16LE(0, 10);
  head.writeUInt16LE(e.dosTime, 12);
  head.writeUInt16LE(e.dosDate, 14);
  head.writeUInt32LE(e.crc, 16);
  head.writeUInt32LE(big ? U32_MAX : e.size, 20);
  head.writeUInt32LE(big ? U32_MAX : e.size, 24);
  head.writeUInt16LE(e.name.length, 28);
  head.writeUInt16LE(extra.length, 30);
  head.writeUInt16LE(0, 32); // commentaire
  head.writeUInt16LE(0, 34); // disque
  head.writeUInt16LE(0, 36); // attributs internes
  head.writeUInt32LE(0, 38); // attributs externes
  head.writeUInt32LE(big ? U32_MAX : e.offset, 42);
  return Buffer.concat([head, e.name, extra]);
}

function endRecords(count: number, size: number, offset: number): Buffer {
  const parts: Buffer[] = [];
  const big = count > 0xffff || size > U32_MAX || offset > U32_MAX;

  if (big) {
    // Enregistrement de fin zip64, puis son localisateur.
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x0606_4b50, 0);
    z.writeBigUInt64LE(BigInt(44), 4); // taille du reste de l'enregistrement
    z.writeUInt16LE(45, 12);
    z.writeUInt16LE(45, 14);
    z.writeUInt32LE(0, 16);
    z.writeUInt32LE(0, 20);
    z.writeBigUInt64LE(BigInt(count), 24);
    z.writeBigUInt64LE(BigInt(count), 32);
    z.writeBigUInt64LE(BigInt(size), 40);
    z.writeBigUInt64LE(BigInt(offset), 48);
    parts.push(z);

    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x0706_4b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(offset + size), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(loc);
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(big ? 0xffff : count, 8);
  end.writeUInt16LE(big ? 0xffff : count, 10);
  end.writeUInt32LE(big ? U32_MAX : size, 12);
  end.writeUInt32LE(big ? U32_MAX : offset, 16);
  end.writeUInt16LE(0, 20);
  parts.push(end);

  return Buffer.concat(parts);
}

/**
 * Fabrique le flux de l'archive. Les fichiers illisibles sont simplement
 * sautés : mieux vaut une archive à laquelle il manque une photo qu'un
 * téléchargement qui échoue au bout de dix minutes.
 */
export function zipStream(entries: ZipEntry[]): Readable {
  const out = new PassThrough();

  void (async () => {
    const written: Written[] = [];
    let offset = 0;
    const used = new Set<string>();

    // Une seule écoute d'erreur pour toute l'archive : en poser une par écriture
    // en accumulait des milliers sur un gros téléchargement.
    let broken: Error | null = null;
    out.on('error', (err) => {
      broken = err;
    });

    const push = (buf: Buffer): Promise<void> =>
      new Promise((resolve, reject) => {
        if (broken) {
          reject(broken);
          return;
        }
        offset += buf.length;
        if (out.write(buf)) resolve();
        else out.once('drain', resolve);
      });

    try {
      for (const entry of entries) {
        // Deux photos peuvent porter le même nom : on suffixe plutôt que
        // d'écraser silencieusement l'une par l'autre.
        let name = entry.name;
        if (used.has(name)) {
          const dot = name.lastIndexOf('.');
          const base = dot > 0 ? name.slice(0, dot) : name;
          const ext = dot > 0 ? name.slice(dot) : '';
          let n = 2;
          while (used.has(`${base} (${n})${ext}`)) n++;
          name = `${base} (${n})${ext}`;
        }
        used.add(name);

        const nameBuf = Buffer.from(name, 'utf8');
        const stamp = dosStamp(entry.mtime);
        const start = offset;

        let source: fs.ReadStream;
        try {
          await fs.promises.access(entry.path, fs.constants.R_OK);
          source = fs.createReadStream(entry.path);
        } catch {
          continue;
        }

        await push(localHeader(nameBuf, stamp));

        let crc = 0;
        let size = 0;
        let failed = false;
        try {
          for await (const chunk of source) {
            const buf = chunk as Buffer;
            crc = crc32(buf, crc);
            size += buf.length;
            await push(buf);
          }
        } catch {
          failed = true;
        }
        // Le contenu a commencé à partir : on ferme l'entrée proprement avec ce
        // qu'on a pu lire, sinon l'archive entière serait illisible.
        await push(dataDescriptor(crc, size));
        written.push({ name: nameBuf, offset: start, crc, size, dosTime: stamp.time, dosDate: stamp.date });
        if (failed) continue;
      }

      const dirStart = offset;
      for (const e of written) await push(centralEntry(e));
      await push(endRecords(written.length, offset - dirStart, dirStart));
      out.end();
    } catch (err) {
      out.destroy(err as Error);
    }
  })();

  return out;
}
