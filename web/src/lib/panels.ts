/**
 * Modèle des deux barres verticales. Les composants d'affichage et le
 * gestionnaire d'entrées lisent la même liste, ce qui évite qu'une rangée
 * ajoutée à l'écran soit inatteignable à la manette.
 */
export interface PanelRow {
  id: string;
  /** Nombre de champs traversables avec ←/→ à l'intérieur de la rangée. */
  sub: number;
}

export const LEFT_ROWS: PanelRow[] = [
  { id: 'from', sub: 2 }, // [mois] [année]
  { id: 'to', sub: 2 },
  { id: 'place', sub: 1 },
  { id: 'tags', sub: 1 },
  { id: 'mood', sub: 1 },
  { id: 'clear', sub: 1 },
];

/**
 * Sur l'écran Albums, la recherche ne porte plus sur des photos : les dates et
 * le lieu n'ont rien à filtrer. On cherche un album par son nom ou par ses tags.
 */
export const ALBUM_LEFT_ROWS: PanelRow[] = [
  { id: 'name', sub: 1 },
  { id: 'tags', sub: 1 },
  { id: 'clear', sub: 1 },
];

/** Les rangées de la barre de recherche dépendent de ce qu'on regarde. */
export function leftRows(albumsView: boolean): PanelRow[] {
  return albumsView ? ALBUM_LEFT_ROWS : LEFT_ROWS;
}

export function rightRows(isAdmin: boolean): PanelRow[] {
  const rows: PanelRow[] = [
    { id: 'font', sub: 1 },
    { id: 'volume', sub: 1 },
    { id: 'theme', sub: 1 },
    // Diaporama : [secondes] [aléatoire] [mouvement] [démarrage auto].
    { id: 'slideshow', sub: 4 },
    { id: 'admin', sub: 1 },
  ];
  if (isAdmin) rows.push({ id: 'folders', sub: 1 });
  rows.push({ id: 'lang', sub: 3 });
  if (isAdmin) rows.push({ id: 'hidden', sub: 1 });
  return rows;
}

/** Les teintes proposées pour le thème : un arc-en-ciel néon. */
export const HUES = [285, 320, 350, 20, 45, 80, 150, 190, 220, 250];

/** Durées proposées pour une photo de diaporama, en secondes. */
export const SLIDE_SECONDS = [2, 3, 4, 5, 7, 10, 15, 20, 30];
/** Délais avant le démarrage automatique, en minutes. 0 = jamais. */
export const SCREENSAVER_MINUTES = [0, 1, 2, 5, 10, 15, 30, 60];

/**
 * Valeurs maximales des réglages, et nombre de cases dessinées pour chacun.
 * Les deux étaient confondus : le volume allait de 0 à 5 pour six cases, donc
 * la dernière ne s'allumait jamais, même à fond.
 */
export const FONT_MAX = 4; // fontScale 0..4
export const VOLUME_MAX = 5; // volume 0..5, 0 = muet
export const FONT_BOXES = 5;
export const VOLUME_BOXES = 5;
