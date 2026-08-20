import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../../../shared/types';
import { api } from '../lib/api';
import { groupByDay, type Feed } from '../lib/feed';
import { formatDuration } from '../lib/format';
import { buildCells, effectiveTile, TILE_WIDTHS } from '../lib/grid';
import { formatDayHeading, formatMonthLabel, formatShortDay } from '../lib/i18n';
import { useStore } from '../lib/store';
import { IconCheck, IconExpand, IconHeart, IconHide, IconPlay, IconPlus, IconTag } from './Icons';

export interface TileAction {
  (item: MediaItem, action: 'open' | 'add' | 'remove'): void;
}

interface Props {
  feed: Feed;
  /** Vrai dans un album : X retire de l'album au lieu de cacher la photo. */
  inAlbum: boolean;
  /** Cran de zoom de l'écran courant, mémorisé séparément par vue. */
  zoom: number;
  onAction: TileAction;
  onColumns: (cols: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export function Timeline({ feed, inAlbum, zoom, onAction, onColumns, scrollRef }: Props): React.JSX.Element {
  const { nav, settings, selectMode, selection, setNav, setSelection, toggleSelection, t } = useStore();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(6);

  const base = TILE_WIDTHS[zoom] ?? TILE_WIDTHS[2];
  const [tileWidth, setTileWidth] = useState(base);
  const sections = useMemo(() => groupByDay(feed.items), [feed.items]);
  const cells = useMemo(() => buildCells(sections, cols), [sections, cols]);

  // Le nombre de colonnes vient de la mise en page réelle : la navigation
  // ↑/↓ doit suivre ce que l'utilisateur voit, pas une estimation.
  useLayoutEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.clientWidth;
      const tile = effectiveTile(base, width);
      const next = Math.max(1, Math.floor((width + 6) / (tile + 6)));
      setTileWidth(tile);
      setCols(next);
      onColumns(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [base, onColumns]);

  // Charge la suite quand le bas approche.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = (): void => {
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 900) feed.loadMore();
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [feed, scrollRef]);

  // Garde la tuile sélectionnée dans le champ de vision quand on se déplace à
  // la manette, et charge la suite si on atteint le bas de ce qui est chargé.
  const focusIndex = nav.zone === 'content' ? nav.contentIndex : -1;
  useEffect(() => {
    if (focusIndex < 0) return;
    const el = document.querySelector<HTMLElement>(`[data-flat="${focusIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (focusIndex >= feed.items.length - cols * 3) feed.loadMore();
  }, [focusIndex, feed, cols]);

  if (feed.items.length === 0 && !feed.loading) {
    return (
      <div className="empty">
        <span className="big">{inAlbum ? t.emptyAlbum : t.noResults}</span>
      </div>
    );
  }

  const tile = (item: MediaItem, index: number): React.JSX.Element => (
    <Tile
      key={item.id}
      item={item}
      zoom={zoom}
      flat={index}
      focused={focusIndex === index}
      picked={selection.includes(item.id)}
      selectMode={selectMode}
      inAlbum={inAlbum}
      onFocus={() => setNav((n) => ({ ...n, zone: 'content', contentIndex: index }))}
      onPrimary={() => {
        if (selectMode) toggleSelection(item.id);
        else onAction(item, 'open');
      }}
      onAdd={() => onAction(item, 'add')}
      onRemove={() => onAction(item, 'remove')}
    />
  );

  /**
   * Pastille de sélection d'une journée entière. Cochée quand toute la journée
   * est prise ; un clic prend le reste, un second clic relâche la journée.
   */
  const dayPick = (items: MediaItem[]): React.JSX.Element | null => {
    if (!selectMode) return null;
    const ids = items.map((i) => i.id);
    const chosen = new Set(selection);
    const all = ids.length > 0 && ids.every((id) => chosen.has(id));
    const some = !all && ids.some((id) => chosen.has(id));

    return (
      <button
        className={`pick-dot day${all ? ' on' : some ? ' part' : ''}`}
        title={all ? t.clearSelection : t.selectAll}
        onClick={(e) => {
          e.stopPropagation();
          const others = selection.filter((id) => !ids.includes(id));
          setSelection(all ? others : [...others, ...ids]);
        }}
      >
        {all && <IconCheck />}
      </button>
    );
  };

  const footer = (
    <>
      {feed.loading && <div className="mini" style={{ padding: '12px 2px' }}>{t.loading}</div>}
      {cells.length > 0 && !feed.hasMore && (
        <div className="mini" style={{ padding: '8px 2px' }}>{t.photoCount(feed.total)}</div>
      )}
    </>
  );

  // Vue condensée : chaque journée est un bloc insécable posé dans un flux qui
  // passe à la ligne. Une journée trop large pour la ligne restante bascule
  // entière à la suivante, au lieu d'être coupée en deux.
  if (settings.layout === 'compact') {
    let running = 0;
    return (
      <div ref={gridRef}>
        <div className="compact-flow">
          {sections.map((section) => {
            const start = running;
            running += section.items.length;
            const perRow = Math.max(1, Math.min(section.items.length, cols));
            const width = perRow * tileWidth + (perRow - 1) * 6;
            const holdsFocus = focusIndex >= start && focusIndex < running;
            return (
              <section
                key={section.day}
                className={`compact-day${holdsFocus ? ' current' : ''}`}
                style={{ width }}
              >
                <span className="lab">
                  {formatShortDay(section.day, settings.lang)}
                  {dayPick(section.items)}
                </span>
                <div
                  className="compact-grid"
                  style={{ gridTemplateColumns: `repeat(${perRow}, ${tileWidth}px)` }}
                >
                  {section.items.map((item, i) => tile(item, start + i))}
                </div>
              </section>
            );
          })}
        </div>
        {footer}
      </div>
    );
  }

  let flat = 0;
  return (
    <div ref={gridRef}>
      {sections.map((section) => {
        const start = flat;
        flat += section.items.length;
        const rows = Math.ceil(section.items.length / cols);
        return (
          <section
            key={section.day}
            className="day-block"
            style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${rows * (tileWidth + 6) + 46}px` }}
          >
            <h2 className="day-head">
              {formatDayHeading(section.day, settings.lang)}
              <span className="cnt">{section.items.length}</span>
              {dayPick(section.items)}
            </h2>
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            >
              {section.items.map((item, i) => tile(item, start + i))}
            </div>
          </section>
        );
      })}
      {footer}
    </div>
  );
}

interface TileProps {
  item: MediaItem;
  zoom: number;
  flat: number;
  focused: boolean;
  picked: boolean;
  selectMode: boolean;
  inAlbum: boolean;
  onFocus: () => void;
  onPrimary: () => void;
  onAdd: () => void;
  onRemove: () => void;
}

function Tile({
  item, zoom, flat, focused, picked, selectMode, inAlbum, onFocus, onPrimary, onAdd, onRemove,
}: TileProps): React.JSX.Element {
  const { t } = useStore();
  const [broken, setBroken] = useState(false);
  const size = zoom >= 3 ? 480 : 240;

  return (
    <div
      className={`tile${focused ? ' focus' : ''}${picked ? ' picked' : ''}${item.hidden ? ' is-hidden' : ''}`}
      data-flat={flat}
      data-media={item.id}
      onMouseEnter={onFocus}
      onClick={onPrimary}
    >
      {!broken ? (
        <img
          src={api.thumbUrl(item.id, size)}
          alt={item.filename}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
          <IconPlay />
        </div>
      )}

      <div className="tile-badge">
        {item.favorite && (
          <span className="badge fav" title={t.favorites}>
            <IconHeart />
          </span>
        )}
        {item.hidden && (
          <span className="badge" title={t.hidden}>
            <IconHide />
          </span>
        )}
        {item.tags.length > 0 && (
          <span className="badge" title={item.tags.join(', ')}>
            <IconTag />
            {item.tags.length}
          </span>
        )}
      </div>

      {item.kind === 'video' && item.duration !== null && (
        <span className="dur">{formatDuration(item.duration)}</span>
      )}

      {selectMode ? (
        <span className={`pick-dot${picked ? ' on' : ''}`}>{picked && <IconCheck />}</span>
      ) : (
        <div className="tile-actions">
          <div className="action-ring">
            <button
              className="act y"
              title={t.addToAlbum}
              onClick={(e) => {
                e.stopPropagation();
                onAdd();
              }}
            >
              <IconPlus />
              <span className="act-key">Y</span>
            </button>
            <button
              className="act x"
              title={inAlbum ? t.removeFromAlbum : item.hidden ? t.unhide : t.hide}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <IconHide />
              <span className="act-key">X</span>
            </button>
            <button
              className="act a"
              title={t.fullscreen}
              onClick={(e) => {
                e.stopPropagation();
                onPrimary();
              }}
            >
              <IconExpand />
              <span className="act-key">A</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Curseur de dates latéral : un repère par mois, comme dans Google Photos.
 *
 * `aim` est le mois visé au stick droit. Viser ne déplace rien — c'est A qui
 * confirme. Le repère visé s'affiche toujours avec son étiquette, même quand la
 * liste est trop dense pour toutes les montrer.
 */
export function DateScrubber({
  buckets,
  aim,
  onPick,
}: {
  buckets: Array<{ month: number; count: number }>;
  aim: number | null;
  onPick: (month: number) => void;
}): React.JSX.Element | null {
  const { settings, anchor } = useStore();
  if (buckets.length < 2) return null;

  const max = Math.max(...buckets.map((b) => b.count));
  // Au-delà d'une trentaine de repères on n'étiquette qu'un mois sur n.
  const stride = Math.max(1, Math.ceil(buckets.length / 26));
  const current = buckets.findIndex((b) => anchor !== null && anchor >= b.month);

  return (
    // Le curseur est estompé au repos ; viser à la manette doit le réveiller,
    // sinon on ne verrait pas ce qu'on pointe faute de survol à la souris.
    <div className={`scrubber${aim !== null ? ' aiming' : ''}`}>
      {buckets.map((bucket, i) => {
        const aimed = i === aim;
        const on = anchor !== null && anchor >= bucket.month;
        return (
          <button
            key={bucket.month}
            className={`scrub-mark${on && i === current ? ' on' : ''}${aimed ? ' aim' : ''}`}
            onClick={() => onPick(bucket.month)}
            title={`${formatMonthLabel(bucket.month, settings.lang)} · ${bucket.count}`}
          >
            {(i % stride === 0 || aimed) && (
              <span>{formatMonthLabel(bucket.month, settings.lang)}</span>
            )}
            {aimed && <span className="aim-key">A</span>}
            <span
              className="bar"
              style={{ width: `${8 + (bucket.count / max) * 16}px` }}
            />
          </button>
        );
      })}
    </div>
  );
}
