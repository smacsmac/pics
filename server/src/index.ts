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
import { isDistant } from './origin.js';
import { ensureDirs, HOST, PORT } from './paths.js';
import { registerRoutes } from './routes.js';
import { restartWatching, scan } from './scanner.js';
import { registerShareRoutes } from './share-routes.js';
import { pruneShares } from './share.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(here, '../../web/dist');

/**
 * Les seules adresses qu'un visiteur distant peut atteindre.
 *
 * Écrit comme une liste blanche et non comme une liste de refus : une route
 * ajoutée au projet plus tard sera refusée par défaut aux visiteurs distants.
 * L'inverse — refuser une liste connue — laisserait chaque nouvelle route
 * ouverte au monde en attendant qu'on y pense.
 */
const DISTANT_OK = [
  /^\/p\/[0-9a-f]{64}$/, // la page d'un lien de partage
  /^\/api\/share\/[0-9a-f]{64}(\/.*)?$/, // ses données
  /^\/assets\/[A-Za-z0-9._-]+$/, // le JS et le CSS de l'interface
  /^\/favicon\.[a-z0-9]+$/,
];

function distantAllowed(url: string): boolean {
  const pathname = url.split('?')[0].replace(/\/+$/, '') || '/';
  return DISTANT_OK.some((allowed) => allowed.test(pathname));
}

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
  /**
   * Le garde par origine. Première chose exécutée pour chaque requête, avant
   * les routes et avant les fichiers statiques.
   *
   * Depuis le réseau local, rien ne change : l'application reste grande ouverte,
   * comme elle l'a toujours été. Depuis l'extérieur, seules les routes de
   * partage existent — tout le reste répond 404, y compris la page d'accueil.
   *
   * 404 et non 403, à dessein : un visiteur qui tombe sur l'adresse du tunnel
   * sans lien ne doit même pas apprendre qu'il y a une galerie derrière.
   *
   * Ce garde est la seule raison pour laquelle on peut exposer Photon. Sans lui,
   * ouvrir le port donnerait la bibliothèque entière à qui la trouve : `isAdmin`
   * répond « oui » par défaut, parce que le projet est né en supposant que seul
   * le salon peut atteindre le port.
   */
  app.addHook('onRequest', async (req, reply) => {
    if (!isDistant(req)) return;
    if (distantAllowed(req.url)) return;
    return reply.code(404).type('text/plain; charset=utf-8').send('Not found\n');
  });

  registerRoutes(app, () => restartWatching(sweep));
  registerShareRoutes(app);

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
  // Les liens expirés depuis plus d'un mois s'effacent : la liste de partage
  // doit rester lisible sans qu'on ait à faire le ménage à la main.
  pruneShares();

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
