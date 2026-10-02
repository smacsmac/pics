import type { Album } from '../../../shared/types';
import type { dict } from './i18n';

/**
 * Deux albums ne sont pas faits à la main : les favoris et « cette semaine ».
 *
 * Ils ne se renomment pas, ne se suppriment pas, et on n'y range pas une photo
 * par le menu — leur contenu vient d'ailleurs. Le serveur refuse déjà tout
 * cela ; cette fonction sert à ne pas proposer à l'écran ce qui serait refusé.
 */
export function isAutoAlbum(album: Album): boolean {
  return album.kind !== 'user';
}

/**
 * Le nom affiché. Celui des albums automatiques vient des traductions et non
 * de la base : il doit suivre la langue de l'interface, alors qu'un album créé
 * par l'utilisateur garde le titre qu'il lui a donné, quelle que soit la langue.
 */
export function albumLabel(album: Album, t: ReturnType<typeof dict>): string {
  if (album.kind === 'favorites') return t.favorites;
  if (album.kind === 'recent') return t.recentlyAdded;
  return album.name;
}
