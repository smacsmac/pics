import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { db } from './db.js';
import { preloadGeocoder } from './geocode.js';
import { drainInbox, ensureTempDir } from './import.js';
import { ensureDirs, HOST, PORT } from './paths.js';
import { registerRoutes } from './routes.js';
import { restartWatching, scan } from './scanner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

/**
 * Ouvre le navigateur au démarrage sur Windows et macOS. Sous Linux les
 * environnements varient trop (serveur sans écran, session distante) : on se
 * contente d'afficher l'adresse.
 */
function openBrowser(url: string): void {
  if (process.env.PHOTON_OPEN === '0') return;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* pas de navigateur disponible : l'adresse est affichée juste au-dessus */
  }
}

function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

async function main(): Promise<void> {
  ensureDirs();
  preloadGeocoder();

  const app = Fastify({
    logger: { level: process.env.PHOTON_LOG ?? 'warn' },
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, {
    // Assez large pour une vidéo de téléphone ; le fichier est écrit en flux,
    // il ne passe jamais entièrement par la mémoire.
    limits: { fileSize: 4 * 1024 * 1024 * 1024, files: 64, fields: 8 },
  });
  registerRoutes(app, () => restartWatching(sweep));

  if (fs.existsSync(WEB_DIST)) {
    await app.register(fastifyStatic, { root: WEB_DIST, index: ['index.html'] });
    // Une seule page côté client : tout ce qui n'est pas /api renvoie l'index.
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send("L'interface n'est pas encore construite.\nLancez : npm run build\n");
    });
  }

  await app.listen({ port: PORT, host: HOST });

  const roots = db
    .prepare(`SELECT COUNT(*) AS n FROM roots WHERE kind IN ('photos', 'import')`)
    .get() as { n: number };

  console.log('');
  console.log('  Photon — galerie photo locale');
  console.log(`  Sur cet ordinateur :  http://localhost:${PORT}`);
  for (const address of localAddresses()) {
    console.log(`  Sur le réseau local : http://${address}:${PORT}`);
  }
  console.log('');

  if (roots.n === 0) {
    console.log('  Aucun dossier de photos configuré.');
    console.log('  Ouvrez les réglages (roue dentée) → Dossiers pour en ajouter un.');
    console.log('');
  } else {
    void scan();
  }

  ensureTempDir();

  // Un fichier déposé pendant que le serveur était éteint doit être rangé au
  // démarrage, pas seulement à la prochaine modification du dossier.
  const sweep = async (): Promise<void> => {
    const filed = await drainInbox();
    if (filed.some((r) => r.outcome === 'stored')) console.log(`  ${filed.length} fichier(s) rangé(s).`);
    await scan();
  };
  void sweep();
  restartWatching(sweep);

  openBrowser(`http://localhost:${PORT}`);
}

main().catch((err) => {
  console.error('Démarrage impossible :', err);
  process.exit(1);
});
