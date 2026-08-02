import { useEffect, useRef } from 'react';
import type { Album } from '../../../shared/types';
import { useStore } from '../lib/store';
import {
  IconAlbum, IconGear, IconHeart, IconPlus, IconSearch, IconVideo,
} from './Icons';

/**
 * Positions dans la barre du haut. Les cinq premières sont fixes ; les tuiles
 * d'albums récents occupent ensuite autant de places qu'il y a d'espace, et
 * « paramètres » ferme la marche — d'où un index calculé plutôt que constant.
 */
export const TOP = {
  SEARCH: 0,
  ALBUMS: 1,
  FAVORITES: 2,
  VIDEOS: 3,
  NEW_ALBUM: 4,
  RECENT_START: 5,
} as const;

export function settingsIndex(recentVisible: number): number {
  return TOP.RECENT_START + recentVisible;
}

export function topCount(recentVisible: number): number {
  return settingsIndex(recentVisible) + 1;
}

/** Largeur minimale confortable pour une tuile d'album récent, gouttière comprise. */
const CHIP_WIDTH = 172;
const MAX_RECENT_SLOTS = 8;

interface Props {
  recentAlbums: Album[];
  recentOffset: number;
  /** Nombre de tuiles réellement affichées, décidé par la mesure ci-dessous. */
  recentVisible: number;
  onSlotsMeasured: (slots: number) => void;
  onActivate: (index: number) => void;
  onHover: (index: number) => void;
}

export function TopBar({
  recentAlbums, recentOffset, recentVisible, onSlotsMeasured, onActivate, onHover,
}: Props): React.JSX.Element {
  const { nav, view, t } = useStore();
  const recentsRef = useRef<HTMLDivElement | null>(null);
  const focused = nav.zone === 'top' ? nav.topIndex : -1;
  const gear = settingsIndex(recentVisible);

  // La zone des récents est dimensionnée par flexbox, indépendamment de son
  // contenu : on peut donc en déduire le nombre de tuiles sans boucle infinie.
  useEffect(() => {
    const el = recentsRef.current;
    if (!el) return;
    const measure = (): void => {
      const slots = Math.floor((el.clientWidth + 10) / CHIP_WIDTH);
      onSlotsMeasured(Math.max(1, Math.min(MAX_RECENT_SLOTS, slots)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onSlotsMeasured]);

  const isActiveView = (index: number): boolean => {
    switch (index) {
      case TOP.ALBUMS: return view.kind === 'albums';
      case TOP.VIDEOS: return view.kind === 'videos';
      case TOP.NEW_ALBUM: return view.kind === 'newAlbum';
      default: return false;
    }
  };

  const button = (
    index: number,
    label: string,
    Icon: (p: { className?: string }) => React.JSX.Element,
  ): React.JSX.Element => (
    <button
      className={`topbtn${focused === index ? ' on' : ''}${isActiveView(index) ? ' active' : ''}`}
      onClick={() => onActivate(index)}
      onMouseEnter={() => onHover(index)}
      title={label}
      aria-label={label}
    >
      <Icon />
      <span className="topbtn-label">{label}</span>
    </button>
  );

  const shown = recentAlbums.slice(recentOffset, recentOffset + recentVisible);
  // Quand il n'y a pas assez d'albums pour remplir, on laisse la place aux
  // boutons plutôt que d'étirer une tuile solitaire sur la moitié de l'écran.
  const filled = shown.length >= recentVisible && recentVisible > 0;

  return (
    <div className="topbar">
      {button(TOP.SEARCH, t.search, IconSearch)}
      {button(TOP.ALBUMS, t.albums, IconAlbum)}
      {button(TOP.FAVORITES, t.favorites, IconHeart)}
      {button(TOP.VIDEOS, t.videos, IconVideo)}
      {button(TOP.NEW_ALBUM, t.newAlbum, IconPlus)}

      <div
        className="recents"
        ref={recentsRef}
        style={{ flex: shown.length === 0 ? '1 1 0' : filled ? '6 1 0' : '0 1 auto' }}
      >
        {shown.map((album, i) => {
          const slot = TOP.RECENT_START + i;
          return (
            <button
              key={album.id}
              className={`recent-chip${focused === slot ? ' on' : ''}`}
              style={{
                ['--chip-hue' as string]: String(album.color),
                flex: filled ? '1 1 0' : '0 0 190px',
              }}
              onClick={() => onActivate(slot)}
              onMouseEnter={() => onHover(slot)}
              title={album.name}
            >
              <span className="n">{album.name}</span>
              <span className="c">{t.photoCount(album.count)}</span>
            </button>
          );
        })}
      </div>

      {button(gear, t.settings, IconGear)}
    </div>
  );
}
