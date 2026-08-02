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
  { id: 'tbd', sub: 1 },
  { id: 'clear', sub: 1 },
];

export function rightRows(isAdmin: boolean): PanelRow[] {
  const rows: PanelRow[] = [
    { id: 'font', sub: 1 },
    { id: 'volume', sub: 1 },
    { id: 'theme', sub: 1 },
    { id: 'admin', sub: 1 },
  ];
  if (isAdmin) rows.push({ id: 'folders', sub: 1 });
  rows.push({ id: 'lang', sub: 3 });
  if (isAdmin) rows.push({ id: 'hidden', sub: 1 });
  return rows;
}

/** Les teintes proposées pour le thème : un arc-en-ciel néon. */
export const HUES = [285, 320, 350, 20, 45, 80, 150, 190, 220, 250];

export const FONT_STEPS = 5;
export const VOLUME_STEPS = 6;
