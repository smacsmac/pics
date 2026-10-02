import type { FastifyRequest } from 'fastify';
import { getSetting, setSetting } from './db.js';

/**
 * D'où vient cette requête : du salon, ou d'Internet ?
 *
 * Toute l'application repose sur une hypothèse qui tenait jusqu'ici : si on
 * atteint le port, c'est qu'on est chez soi. `isAdmin()` répond « oui » par
 * défaut pour cette raison. Le partage d'album casse l'hypothèse — le serveur
 * devient joignable de l'extérieur — et il faut donc savoir distinguer les deux.
 *
 * Le sens de l'erreur n'est pas symétrique, et c'est ce qui dicte toute la
 * logique de ce fichier. Prendre un visiteur du salon pour un visiteur distant
 * le prive de fonctions : c'est agaçant. Prendre un visiteur distant pour
 * quelqu'un du salon lui ouvre la bibliothèque entière : c'est irréparable. En
 * cas de doute, on répond donc « distant ».
 */

/**
 * Le nom d'hôte public, celui du tunnel. Vide = aucun accès distant prévu.
 *
 * Il sert à deux choses : fabriquer le lien à partager, et reconnaître les
 * requêtes qui arrivent par ce chemin.
 */
export function publicHostname(): string {
  return getSetting<string>('publicHostname', '').trim();
}

export function setPublicHostname(value: string): void {
  // On accepte aussi bien « photos.exemple.com » qu'une URL complète collée
  // depuis Cloudflare : on ne garde que le nom d'hôte.
  const cleaned = value
    .trim()
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .toLowerCase();
  setSetting('publicHostname', cleaned.slice(0, 253));
}

/** L'adresse publique complète d'un lien de partage, ou null si rien n'est configuré. */
export function shareLink(token: string): string | null {
  const host = publicHostname();
  return host ? `https://${host}/p/${token}` : null;
}

/**
 * Plages d'adresses qui signifient « sur place » : la boucle locale et les trois
 * plages privées de la RFC 1918, plus le lien-local.
 *
 * `100.64.0.0/10` en fait partie à dessein : c'est la plage de Tailscale. Un
 * appareil n'y figure que si on l'a explicitement invité sur son réseau privé,
 * et l'inviter équivaut donc à lui ouvrir toute la bibliothèque — c'est écrit
 * dans le README, parce que ça surprend.
 */
function isPrivateAddress(raw: string | undefined): boolean {
  if (!raw) return false;
  // Fastify rend parfois une adresse IPv4 habillée en IPv6 (::ffff:192.168.1.4).
  const address = raw.replace(/^::ffff:/i, '').toLowerCase();

  if (address === '127.0.0.1' || address === '::1' || address === 'localhost') return true;

  const v4 = address.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127 || a === 10) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // Tailscale
    return false;
  }

  // IPv6 : liens-locaux (fe80::/10) et adresses uniques locales (fc00::/7).
  if (address.startsWith('fe8') || address.startsWith('fe9') ||
      address.startsWith('fea') || address.startsWith('feb')) return true;
  if (address.startsWith('fc') || address.startsWith('fd')) return true;

  return false;
}

/**
 * En-têtes qu'un proxy ajoute et qu'une requête directe n'a jamais.
 *
 * C'est le signal décisif dans le montage choisi : `cloudflared` tourne sur le
 * PC lui-même et se connecte à `localhost`, donc toute requête venue du tunnel
 * arrive de `127.0.0.1` et aurait l'air parfaitement locale. Sans cette
 * vérification, le garde ne garderait rien du tout.
 *
 * Cloudflare réécrit `cf-connecting-ip` à chaque passage : un visiteur ne peut
 * pas le falsifier pour se faire passer pour local. Et quelqu'un du salon qui
 * ajouterait l'en-tête à la main se restreindrait lui-même — l'erreur va dans
 * le bon sens.
 */
const PROXY_HEADERS = [
  'cf-connecting-ip',
  'x-forwarded-for',
  'x-real-ip',
  'forwarded',
  'cf-ray',
];

export function isDistant(req: FastifyRequest): boolean {
  for (const header of PROXY_HEADERS) {
    if (req.headers[header] !== undefined) return true;
  }

  const host = String(req.headers.host ?? '').split(':')[0].toLowerCase();
  const pub = publicHostname();
  if (pub && host === pub) return true;

  return !isPrivateAddress(req.ip);
}

/**
 * Qui tape, vu du serveur, pour limiter les essais de mot de passe.
 *
 * Derrière un tunnel, `req.ip` vaut `127.0.0.1` pour tout le monde : sans
 * `cf-connecting-ip`, un seul visiteur maladroit bloquerait tous les autres.
 */
export function visitorKey(req: FastifyRequest): string {
  const forwarded = req.headers['cf-connecting-ip'] ?? req.headers['x-real-ip'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.trim();

  const chain = req.headers['x-forwarded-for'];
  if (typeof chain === 'string' && chain.trim()) {
    // Le premier de la liste est le client d'origine.
    return chain.split(',')[0].trim();
  }
  return req.ip;
}
