import type { Album } from '../../../shared/types';
import { useStore } from '../lib/store';
import {
  IconAlbum, IconGear, IconHeart, IconPlus, IconSearch, IconVideo,
} from './Icons';

/** Positions fixes dans la barre du haut ; le reste du code s'y réfère par nom. */
export const TOP = {
  SEARCH: 0,
  ALBUMS: 1,
  FAVORITES: 2,
  VIDEOS: 3,
  NEW_ALBUM: 4,
  RECENT_A: 5,
  RECENT_B: 6,
  SETTINGS: 7,
} as const;

export const TOP_COUNT = 8;

interface Props {
  recentAlbums: Album[];
  recentOffset: number;
  onActivate: (index: number) => void;
  onHover: (index: number) => void;
}

export function TopBar({ recentAlbums, recentOffset, onActivate, onHover }: Props): React.JSX.Element {
  const { nav, view, t } = useStore();
  const focused = nav.zone === 'top' ? nav.topIndex : -1;

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

  const visibleRecents = recentAlbums.slice(recentOffset, recentOffset + 2);

  return (
    <div className="topbar">
      {button(TOP.SEARCH, t.search, IconSearch)}
      {button(TOP.ALBUMS, t.albums, IconAlbum)}
      {button(TOP.FAVORITES, t.favorites, IconHeart)}
      {button(TOP.VIDEOS, t.videos, IconVideo)}
      {button(TOP.NEW_ALBUM, t.newAlbum, IconPlus)}

      <div className="recents">
        {[TOP.RECENT_A, TOP.RECENT_B].map((slot, i) => {
          const album = visibleRecents[i];
          if (!album) return null;
          const focusedHere = focused === slot;
          return (
            <button
              key={slot}
              className={`recent-chip${focusedHere ? ' on' : ''}`}
              style={{ ['--chip-hue' as string]: String(album.color) }}
              onClick={() => onActivate(slot)}
              onMouseEnter={() => onHover(slot)}
              title={album.name}
            >
              <span className="n">{album.kind === 'favorites' ? t.favorites : album.name}</span>
              <span className="c">{t.photoCount(album.count)}</span>
            </button>
          );
        })}
      </div>

      <div className="topbar-spacer" />
      <span className="brand">Photon</span>
      {button(TOP.SETTINGS, t.settings, IconGear)}
    </div>
  );
}
