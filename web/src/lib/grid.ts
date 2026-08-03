import type { DaySection } from './feed';

/** Largeur de tuile visée pour chaque cran de zoom (LB/RB dans la grille). */
export const TILE_WIDTHS = [88, 118, 156, 208, 272];

export interface Cell {
  flat: number;
  section: number;
  row: number;
  col: number;
}

/**
 * Aplatit les sections en cellules positionnées. On garde le repère
 * (section, ligne, colonne) pour que ↑ et ↓ suivent la grille réellement
 * affichée, y compris quand une journée ne remplit pas sa dernière ligne.
 */
export function buildCells(sections: DaySection[], cols: number): Cell[] {
  const cells: Cell[] = [];
  let flat = 0;
  sections.forEach((section, sectionIndex) => {
    section.items.forEach((_, i) => {
      cells.push({
        flat: flat++,
        section: sectionIndex,
        row: Math.floor(i / cols),
        col: i % cols,
      });
    });
  });
  return cells;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/**
 * Déplacement vertical calculé sur la position réelle des tuiles à l'écran,
 * et non sur un index. C'est ce qui permet à ↑/↓ de suivre aussi bien la vue
 * par journée que la vue condensée, où une ligne mélange plusieurs journées.
 *
 * Renvoie null si rien n'est atteignable dans cette direction — l'appelant
 * retombe alors sur le calcul par index, qui sait remonter à la barre du haut.
 */
export function spatialMove(direction: 'up' | 'down', current: number): number | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-flat]'));
  const rects = els
    .map((el) => ({ index: Number(el.dataset.flat), rect: el.getBoundingClientRect() }))
    // Une section hors écran n'est pas mise en page : ses rectangles sont vides.
    .filter((e) => Number.isFinite(e.index) && e.rect.width > 0);

  const from = rects.find((e) => e.index === current);
  if (!from) return null;

  const centerX = from.rect.left + from.rect.width / 2;
  const tolerance = from.rect.height * 0.4;

  const candidates = rects.filter((e) => {
    if (e.index === current) return false;
    const dy = e.rect.top - from.rect.top;
    return direction === 'down' ? dy > tolerance : dy < -tolerance;
  });
  if (candidates.length === 0) return null;

  // D'abord la ligne la plus proche, ensuite la colonne la plus proche dedans.
  const nearestRow = Math.min(...candidates.map((e) => Math.abs(e.rect.top - from.rect.top)));
  const sameRow = candidates.filter(
    (e) => Math.abs(Math.abs(e.rect.top - from.rect.top) - nearestRow) <= tolerance,
  );

  let best = sameRow[0];
  let bestDx = Infinity;
  for (const candidate of sameRow) {
    const dx = Math.abs(candidate.rect.left + candidate.rect.width / 2 - centerX);
    if (dx < bestDx) {
      bestDx = dx;
      best = candidate;
    }
  }
  return best.index;
}

export function moveFocus(
  cells: Cell[],
  sections: DaySection[],
  cols: number,
  current: number,
  direction: Direction,
): number {
  if (cells.length === 0) return 0;
  const index = Math.min(Math.max(current, 0), cells.length - 1);
  const cell = cells[index];

  if (direction === 'left') return Math.max(0, index - 1);
  if (direction === 'right') return Math.min(cells.length - 1, index + 1);

  const sectionStart = (s: number): number => {
    let start = 0;
    for (let i = 0; i < s; i++) start += sections[i].items.length;
    return start;
  };

  const within = (s: number, row: number, col: number): number | null => {
    const length = sections[s]?.items.length ?? 0;
    if (length === 0) return null;
    const wanted = row * cols + col;
    if (wanted < 0 || wanted >= length) return null;
    return sectionStart(s) + wanted;
  };

  if (direction === 'down') {
    const sameSection = within(cell.section, cell.row + 1, cell.col);
    if (sameSection !== null) return sameSection;
    // Dernière ligne partielle : on vise le dernier élément de la journée.
    const lastRow = Math.floor((sections[cell.section].items.length - 1) / cols);
    if (cell.row < lastRow) return sectionStart(cell.section) + sections[cell.section].items.length - 1;

    for (let s = cell.section + 1; s < sections.length; s++) {
      const next = within(s, 0, Math.min(cell.col, sections[s].items.length - 1));
      if (next !== null) return next;
    }
    return cells.length - 1;
  }

  // vers le haut
  const sameSection = within(cell.section, cell.row - 1, cell.col);
  if (sameSection !== null) return sameSection;
  for (let s = cell.section - 1; s >= 0; s--) {
    const length = sections[s]?.items.length ?? 0;
    if (length === 0) continue;
    const lastRow = Math.floor((length - 1) / cols);
    const target = within(s, lastRow, cell.col) ?? sectionStart(s) + length - 1;
    return target;
  }
  return -1; // remonter au-delà de la première ligne rend la main à la barre du haut
}
