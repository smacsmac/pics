import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Album, MediaItem } from '../../shared/types';
import {
  AlbumForm, AlbumMusic, AlbumsGrid, ALBUM_FIELDS, clampPercent, type AlbumDraft,
} from './components/Albums';
import {
  IconCompact, IconGamepad, IconPencil, IconRows, IconSelect, IconX,
} from './components/Icons';
import {
  AddToAlbumSheet, AdminSheet, ContextMenu, FoldersSheet, MonthPickerSheet, Osk,
  PlacePickerSheet, TagEditorSheet, TagPickerSheet, Toasts, type MenuTarget,
} from './components/Overlays';
import { SearchPanel, SettingsPanel, displayMonth } from './components/Panels';
import { DateScrubber, Timeline } from './components/Timeline';
import { TOP, TopBar, settingsIndex, topCount } from './components/TopBar';
import { Viewer } from './components/Viewer';
import { api } from './lib/api';
import { groupByDay, useHistogram, useMediaFeed } from './lib/feed';
import { buildCells, moveFocus, spatialMove, TILE_WIDTHS, type Direction } from './lib/grid';
import { LANGS } from './lib/i18n';
import { onPadStatus, startInput, useInput, type Action, type PadStatus } from './lib/input';
import { FONT_MAX, HUES, LEFT_ROWS, VOLUME_MAX, rightRows } from './lib/panels';
import { useStore } from './lib/store';

export function App(): React.JSX.Element {
  const store = useStore();
  const {
    state, refresh, settings, patchSettings, t, view, openView, back, filters, setFilters,
    clearFilters, filtersActive, query, anchor, setAnchor, nav, setNav, selectMode, setSelectMode,
    selection, setSelection, toggleSelection, setAddToAlbumFor, setTagEditorFor, setOsk,
    sheet, setSheet, toast, tagCursor, setTagCursor,
  } = store;

  const isAdmin = state?.isAdmin ?? false;
  const albums = state?.albums ?? [];
  const favoritesAlbum = albums.find((a) => a.kind === 'favorites');
  const recentAlbums = useMemo(
    () => albums.filter((a) => a.kind !== 'favorites'),
    [albums],
  );

  const isMediaView = view.kind === 'timeline' || view.kind === 'videos' || view.kind === 'album';
  const isForm = view.kind === 'newAlbum' || view.kind === 'editAlbum';

  const feed = useMediaFeed(query, isMediaView);
  const buckets = useHistogram(query, isMediaView);
  const sections = useMemo(() => groupByDay(feed.items), [feed.items]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(6);
  const [albumCols, setAlbumCols] = useState(4);
  const [recentOffset, setRecentOffset] = useState(0);
  const [recentSlots, setRecentSlots] = useState(2);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerPlaying, setViewerPlaying] = useState(false);
  const [viewerInfo, setViewerInfo] = useState(false);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [pad, setPad] = useState<PadStatus>({ connected: false, id: null });
  const [draft, setDraft] = useState<AlbumDraft>({
    name: '', color: 285, musicSlot: null, videoMusicPct: 20,
    background: null, backgroundOpacity: 35, tags: [],
  });

  // Nombre de tuiles d'albums récents réellement à l'écran : ce que la largeur
  // permet, borné par ce qui reste à afficher. Il décale l'index de la roue
  // dentée, donc toute la navigation de la barre du haut en dépend.
  const recentVisible = Math.max(0, Math.min(recentSlots, recentAlbums.length - recentOffset));
  const gearIndex = settingsIndex(recentVisible);

  const currentAlbum: Album | undefined =
    view.kind === 'album' ? albums.find((a) => a.id === view.id)
    : view.kind === 'editAlbum' ? albums.find((a) => a.id === view.id)
    : undefined;

  // ------------------------------------------------------------- démarrage

  useEffect(() => {
    startInput();
    return onPadStatus(setPad);
  }, []);

  // Fond de la vue alpha : une favorite au hasard, renouvelée régulièrement.
  useEffect(() => {
    let alive = true;
    const pick = (): void => {
      void api
        .randomFavorite()
        .then(({ id }) => {
          if (alive) setBackdrop(id === null ? null : api.thumbUrl(id, 960));
        })
        .catch(() => {});
    };
    pick();
    const timer = setInterval(pick, 45_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [state?.counts.photos]);

  // Avancement du scan poussé par le serveur ; on rafraîchit à la fin.
  useEffect(() => {
    const source = new EventSource('/api/scan/stream');
    let wasRunning = false;
    source.onmessage = (ev) => {
      try {
        const status = JSON.parse(ev.data) as { running: boolean };
        if (wasRunning && !status.running) {
          void refresh();
          feed.reload();
        }
        wasRunning = status.running;
      } catch {
        /* trame incomplète */
      }
    };
    return () => source.close();
    // feed.reload est stable ; on ne veut pas relancer le flux à chaque page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    if (view.kind === 'editAlbum' && currentAlbum) {
      setDraft({
        name: currentAlbum.name,
        color: currentAlbum.color,
        musicSlot: currentAlbum.musicSlot,
        videoMusicPct: currentAlbum.videoMusicPct,
        background: currentAlbum.background,
        backgroundOpacity: currentAlbum.backgroundOpacity,
        tags: currentAlbum.tags,
      });
    }
    if (view.kind === 'newAlbum') {
      setDraft({
        name: '', color: settings.hue, musicSlot: null, videoMusicPct: 20,
        background: null, backgroundOpacity: 35, tags: [],
      });
    }
  }, [view, currentAlbum, settings.hue]);

  // ------------------------------------------------------------ actions

  const contentCount = isMediaView
    ? feed.items.length
    : view.kind === 'albums'
      ? albums.length
      : isForm
        ? ALBUM_FIELDS.length
        : 0;

  const focusedItem: MediaItem | undefined = isMediaView ? feed.items[nav.contentIndex] : undefined;

  const targetIds = useCallback(
    (item?: MediaItem): number[] => {
      if (selectMode && selection.length > 0) return selection;
      return item ? [item.id] : [];
    },
    [selectMode, selection],
  );

  const doAddToAlbum = useCallback(
    (item?: MediaItem) => {
      const ids = targetIds(item);
      if (ids.length === 0) return;
      if (!isAdmin) {
        toast(t.adminOnly);
        return;
      }
      setAddToAlbumFor(ids);
    },
    [targetIds, isAdmin, setAddToAlbumFor, t.adminOnly, toast],
  );

  /** X sur une photo : la retirer de l'album courant, ou la cacher ailleurs. */
  const doRemoveOrHide = useCallback(
    async (item?: MediaItem) => {
      const ids = targetIds(item);
      if (ids.length === 0) return;
      if (!isAdmin) {
        toast(t.adminOnly);
        return;
      }
      if (view.kind === 'album') {
        await api.albumMedia(view.id, ids, true);
        feed.dropItems(ids);
        toast(t.removeFromAlbum);
      } else {
        const nextHidden = !(item?.hidden ?? false);
        await api.hide(ids, nextHidden);
        if (nextHidden && !settings.showHidden) feed.dropItems(ids);
        else feed.patchItems(ids, { hidden: nextHidden });
        toast(nextHidden ? t.hide : t.unhide);
      }
      if (selectMode) setSelection([]);
      await refresh();
    },
    [targetIds, isAdmin, view, feed, settings.showHidden, selectMode, setSelection, refresh, t, toast],
  );

  const toggleFavorite = useCallback(
    async (item: MediaItem) => {
      if (!favoritesAlbum || !isAdmin) {
        toast(t.adminOnly);
        return;
      }
      const ids = targetIds(item);
      await api.albumMedia(favoritesAlbum.id, ids, item.favorite);
      feed.patchItems(ids, { favorite: !item.favorite });
      await refresh();
    },
    [favoritesAlbum, isAdmin, targetIds, feed, refresh, t.adminOnly, toast],
  );

  const openViewer = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerPlaying(false);
    setViewerInfo(false);
  }, []);

  const activateTop = useCallback(
    (index: number) => {
      switch (index) {
        case TOP.SEARCH:
          setNav((n) => ({ ...n, zone: 'left', topIndex: TOP.SEARCH, panelIndex: 0, subIndex: 0 }));
          break;
        case TOP.HOME:
          openView({ kind: 'timeline' });
          break;
        case TOP.ALBUMS:
          openView({ kind: 'albums' });
          break;
        case TOP.FAVORITES:
          if (favoritesAlbum) openView({ kind: 'album', id: favoritesAlbum.id });
          break;
        case TOP.VIDEOS:
          openView({ kind: 'videos' });
          break;
        case TOP.NEW_ALBUM:
          if (isAdmin) openView({ kind: 'newAlbum' });
          else toast(t.adminOnly);
          break;
        default: {
          if (index === gearIndex) {
            setNav((n) => ({ ...n, zone: 'right', topIndex: gearIndex, panelIndex: 0, subIndex: 0 }));
            break;
          }
          const album = recentAlbums[recentOffset + (index - TOP.RECENT_START)];
          if (album) openView({ kind: 'album', id: album.id });
        }
      }
    },
    [setNav, openView, favoritesAlbum, isAdmin, recentAlbums, recentOffset, gearIndex, t.adminOnly, toast],
  );

  const submitAlbum = useCallback(async () => {
    if (!draft.name.trim()) return;
    if (view.kind === 'newAlbum') {
      const album = await api.createAlbum(draft);
      await refresh();
      openView({ kind: 'album', id: album.id });
    } else if (view.kind === 'editAlbum') {
      await api.updateAlbum(view.id, draft);
      await refresh();
      back();
    }
  }, [draft, view, refresh, openView, back]);

  // ------------------------------------------------- panneaux (valeurs -/+)

  const bumpLeftRow = useCallback(
    (delta: number) => {
      const row = LEFT_ROWS[nav.panelIndex];
      if (!row) return;
      const bounds = state?.bounds ?? { min: null, max: null };

      if (row.id === 'from' || row.id === 'to') {
        const which = row.id;
        const fallback = which === 'from' ? bounds.min : bounds.max;
        const base = displayMonth(which === 'from' ? filters.from : filters.to, fallback);
        const next =
          nav.subIndex === 0
            ? (() => {
                const total = base.year * 12 + base.month + delta;
                return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
              })()
            : { ...base, year: base.year + delta };
        setFilters((f) => (which === 'from' ? { ...f, from: next } : { ...f, to: next }));
        return;
      }

      if (row.id === 'place') {
        const places = state?.places ?? [];
        if (places.length === 0) return;
        const current = filters.place ? places.indexOf(filters.place) : -1;
        const next = current + delta;
        setFilters((f) => ({
          ...f,
          place: next < 0 || next >= places.length ? null : places[next],
        }));
        return;
      }

      if (row.id === 'tags') {
        const tags = state?.tags ?? [];
        if (tags.length > 0) setTagCursor(tagCursor + delta);
      }
    },
    [nav.panelIndex, nav.subIndex, state, filters, setFilters, tagCursor, setTagCursor],
  );

  const bumpRightRow = useCallback(
    (delta: number) => {
      const rows = rightRows(isAdmin);
      const row = rows[nav.panelIndex];
      if (!row) return;
      const clamp = (value: number, max: number): number => Math.min(max, Math.max(0, value));

      switch (row.id) {
        case 'font':
          patchSettings({ fontScale: clamp(settings.fontScale + delta, FONT_MAX) });
          break;
        case 'volume':
          patchSettings({ volume: clamp(settings.volume + delta, VOLUME_MAX) });
          break;
        case 'theme': {
          const index = HUES.indexOf(settings.hue);
          const next = (((index < 0 ? 0 : index) + delta) % HUES.length + HUES.length) % HUES.length;
          patchSettings({ hue: HUES[next] });
          break;
        }
        case 'lang': {
          const index = LANGS.findIndex((l) => l.code === settings.lang);
          const next = ((index + delta) % LANGS.length + LANGS.length) % LANGS.length;
          patchSettings({ lang: LANGS[next].code });
          break;
        }
        case 'hidden':
          patchSettings({ showHidden: !settings.showHidden });
          break;
        default:
          break;
      }
    },
    [isAdmin, nav.panelIndex, settings, patchSettings],
  );

  const confirmLeftRow = useCallback(() => {
    const row = LEFT_ROWS[nav.panelIndex];
    if (!row) return;
    if (row.id === 'from' || row.id === 'to') {
      setSheet({
        kind: 'monthPicker',
        which: row.id,
        field: nav.subIndex === 0 ? 'month' : 'year',
      });
    } else if (row.id === 'place') setSheet({ kind: 'placePicker' });
    else if (row.id === 'tags') {
      const tags = state?.tags ?? [];
      const tag = tags.length > 0 ? tags[((tagCursor % tags.length) + tags.length) % tags.length] : null;
      if (tag) {
        setFilters((f) => ({
          ...f,
          tags: f.tags.includes(tag) ? f.tags.filter((x) => x !== tag) : [...f.tags, tag],
        }));
      } else {
        setSheet({ kind: 'tagPicker' });
      }
    } else if (row.id === 'clear') clearFilters();
  }, [nav.panelIndex, nav.subIndex, setSheet, state, tagCursor, setFilters, clearFilters]);

  const confirmRightRow = useCallback(() => {
    const rows = rightRows(isAdmin);
    const row = rows[nav.panelIndex];
    if (!row) return;
    if (row.id === 'admin') setSheet({ kind: 'admin' });
    else if (row.id === 'folders') setSheet({ kind: 'folders' });
    else if (row.id === 'lang') patchSettings({ lang: LANGS[nav.subIndex]?.code ?? settings.lang });
    else if (row.id === 'hidden') patchSettings({ showHidden: !settings.showHidden });
    else bumpRightRow(1);
  }, [isAdmin, nav.panelIndex, nav.subIndex, setSheet, patchSettings, settings, bumpRightRow]);

  // ------------------------------------------------------ gestion centrale

  const handle = useCallback(
    (action: Action): boolean => {
      // Une surcouche est ouverte : elle a son propre gestionnaire, plus bas
      // dans la pile. On décline pour lui laisser la main.
      if (sheet || store.osk || store.addToAlbumFor || store.tagEditorFor) return false;

      if (menu) {
        if (action === 'back') setMenu(null);
        return true;
      }

      // LT/RT sont réservées à la barre du haut : elles y ramènent depuis
      // n'importe où, ce qui referme au passage la barre latérale ouverte.
      if (action === 'tabPrev' || action === 'tabNext') {
        if (viewerIndex !== null) return true;
        const delta = action === 'tabNext' ? 1 : -1;
        setNav((n) => ({
          ...n,
          zone: 'top',
          topIndex: Math.min(topCount(recentVisible) - 1, Math.max(0, n.topIndex + delta)),
        }));
        return true;
      }

      // ---- visionneuse plein écran
      if (viewerIndex !== null) {
        const item = feed.items[viewerIndex];
        switch (action) {
          case 'back':
            setViewerIndex(null);
            setViewerPlaying(false);
            break;
          case 'left':
          case 'dec':
            setViewerIndex((i) => Math.max(0, (i ?? 0) - 1));
            setViewerPlaying(false);
            break;
          case 'right':
          case 'inc':
            setViewerIndex((i) => {
              const next = Math.min(feed.items.length - 1, (i ?? 0) + 1);
              if (next >= feed.items.length - 4) feed.loadMore();
              return next;
            });
            setViewerPlaying(false);
            break;
          case 'confirm':
            if (item?.kind === 'video') setViewerPlaying((p) => !p);
            else setViewerInfo((v) => !v);
            break;
          case 'actionY':
            doAddToAlbum(item);
            break;
          case 'actionX':
            void doRemoveOrHide(item);
            break;
          default:
            break;
        }
        return true;
      }

      // ---- mode sélection : Select bascule depuis n'importe où
      if (action === 'selectMode') {
        if (!isAdmin) {
          toast(t.adminOnly);
          return true;
        }
        setSelectMode(!selectMode);
        return true;
      }

      // ---- barre du haut
      if (nav.zone === 'top') {
        switch (action) {
          case 'left':
            setNav((n) => ({ ...n, topIndex: Math.max(0, n.topIndex - 1) }));
            break;
          case 'right':
            setNav((n) => ({ ...n, topIndex: Math.min(topCount(recentVisible) - 1, n.topIndex + 1) }));
            break;
          case 'down':
            if (nav.topIndex === TOP.SEARCH) setNav((n) => ({ ...n, zone: 'left', panelIndex: 0, subIndex: 0 }));
            else if (nav.topIndex === gearIndex) setNav((n) => ({ ...n, zone: 'right', panelIndex: 0, subIndex: 0 }));
            else setNav((n) => ({ ...n, zone: 'content' }));
            break;
          case 'confirm':
            activateTop(nav.topIndex);
            break;
          case 'dec':
            if (nav.topIndex >= TOP.RECENT_START && nav.topIndex < gearIndex) {
              setRecentOffset((o) => Math.max(0, o - 1));
            }
            break;
          case 'inc':
            if (nav.topIndex >= TOP.RECENT_START && nav.topIndex < gearIndex) {
              setRecentOffset((o) => Math.min(Math.max(0, recentAlbums.length - recentVisible), o + 1));
            }
            break;
          case 'back':
            setNav((n) => ({ ...n, zone: 'content' }));
            break;
          default:
            break;
        }
        return true;
      }

      // ---- barres verticales
      if (nav.zone === 'left' || nav.zone === 'right') {
        const rows = nav.zone === 'left' ? LEFT_ROWS : rightRows(isAdmin);
        const row = rows[nav.panelIndex];
        switch (action) {
          case 'up':
            if (nav.panelIndex === 0) {
              setNav((n) => ({
                ...n,
                zone: 'top',
                topIndex: n.zone === 'left' ? TOP.SEARCH : gearIndex,
              }));
            } else {
              setNav((n) => ({ ...n, panelIndex: n.panelIndex - 1, subIndex: 0 }));
            }
            break;
          case 'down':
            setNav((n) => ({
              ...n,
              panelIndex: Math.min(rows.length - 1, n.panelIndex + 1),
              subIndex: 0,
            }));
            break;
          case 'left':
            setNav((n) => ({ ...n, subIndex: Math.max(0, n.subIndex - 1) }));
            break;
          case 'right':
            setNav((n) => ({ ...n, subIndex: Math.min((row?.sub ?? 1) - 1, n.subIndex + 1) }));
            break;
          case 'dec':
            (nav.zone === 'left' ? bumpLeftRow : bumpRightRow)(-1);
            break;
          case 'inc':
            (nav.zone === 'left' ? bumpLeftRow : bumpRightRow)(1);
            break;
          case 'confirm':
            (nav.zone === 'left' ? confirmLeftRow : confirmRightRow)();
            break;
          case 'back':
            setNav((n) => ({ ...n, zone: 'content' }));
            break;
          default:
            break;
        }
        return true;
      }

      // ---- contenu
      switch (action) {
        case 'dec':
        case 'inc': {
          if (isForm) break;
          const next = Math.min(
            TILE_WIDTHS.length - 1,
            Math.max(0, settings.thumbSize + (action === 'inc' ? -1 : 1)),
          );
          patchSettings({ thumbSize: next });
          break;
        }
        case 'back':
          if (selectMode) setSelectMode(false);
          else back();
          break;
        default:
          break;
      }

      if (isMediaView) {
        const cells = buildCells(sections, cols);
        switch (action) {
          case 'up':
          case 'down': {
            // La position réelle à l'écran prime : elle vaut pour les deux
            // dispositions. Le calcul par index reste le filet de sécurité,
            // et c'est lui qui sait rendre la main à la barre du haut.
            const spatial = spatialMove(action, nav.contentIndex);
            const next =
              spatial ?? moveFocus(cells, sections, cols, nav.contentIndex, action as Direction);
            if (next < 0) setNav((n) => ({ ...n, zone: 'top', topIndex: TOP.HOME }));
            else setNav((n) => ({ ...n, contentIndex: next }));
            break;
          }
          case 'left':
          case 'right': {
            const next = moveFocus(cells, sections, cols, nav.contentIndex, action as Direction);
            if (next < 0) setNav((n) => ({ ...n, zone: 'top', topIndex: TOP.HOME }));
            else setNav((n) => ({ ...n, contentIndex: next }));
            break;
          }
          case 'confirm':
            if (selectMode && focusedItem) toggleSelection(focusedItem.id);
            else if (focusedItem) openViewer(nav.contentIndex);
            break;
          case 'actionY':
            doAddToAlbum(focusedItem);
            break;
          case 'actionX':
            void doRemoveOrHide(focusedItem);
            break;
          default:
            break;
        }
        return true;
      }

      if (view.kind === 'albums') {
        const move = (delta: number): void =>
          setNav((n) => ({
            ...n,
            contentIndex: Math.min(albums.length - 1, Math.max(0, n.contentIndex + delta)),
          }));
        switch (action) {
          case 'left': move(-1); break;
          case 'right': move(1); break;
          case 'down': move(albumCols); break;
          case 'up':
            if (nav.contentIndex < albumCols) setNav((n) => ({ ...n, zone: 'top', topIndex: TOP.ALBUMS }));
            else move(-albumCols);
            break;
          case 'confirm': {
            const album = albums[nav.contentIndex];
            if (album) openView({ kind: 'album', id: album.id });
            break;
          }
          case 'actionY': {
            const album = albums[nav.contentIndex];
            if (album && album.kind !== 'favorites' && isAdmin) openView({ kind: 'editAlbum', id: album.id });
            break;
          }
          default:
            break;
        }
        return true;
      }

      if (isForm) {
        const field = ALBUM_FIELDS[nav.contentIndex];
        switch (action) {
          case 'up':
            if (nav.contentIndex === 0) setNav((n) => ({ ...n, zone: 'top', topIndex: TOP.NEW_ALBUM }));
            else setNav((n) => ({ ...n, contentIndex: n.contentIndex - 1 }));
            break;
          case 'down':
            setNav((n) => ({
              ...n,
              contentIndex: Math.min(ALBUM_FIELDS.length - 1, n.contentIndex + 1),
            }));
            break;
          case 'left':
          case 'right': {
            const delta = action === 'right' ? 1 : -1;
            if (field === 'color') {
              const index = HUES.indexOf(draft.color);
              const next = (((index < 0 ? 0 : index) + delta) % HUES.length + HUES.length) % HUES.length;
              setDraft((d) => ({ ...d, color: HUES[next] }));
            } else if (field === 'music') {
              const options: Array<number | null> = [null, 1, 2, 3, 4, 5];
              const index = options.indexOf(draft.musicSlot);
              const next = ((index + delta) % options.length + options.length) % options.length;
              setDraft((d) => ({ ...d, musicSlot: options[next] }));
            } else if (field === 'videoMusic') {
              // Par pas de 5 à la manette ; la saisie exacte passe par le clavier.
              setDraft((d) => ({ ...d, videoMusicPct: clampPercent(d.videoMusicPct + delta * 5) }));
            } else if (field === 'backgroundOpacity') {
              setDraft((d) => ({
                ...d,
                backgroundOpacity: clampPercent(d.backgroundOpacity + delta * 5),
              }));
            } else if (field === 'background') {
              const options: Array<string | null> = [null, ...(state?.backgrounds ?? [])];
              const index = options.indexOf(draft.background);
              const next = ((index + delta) % options.length + options.length) % options.length;
              setDraft((d) => ({ ...d, background: options[next] }));
            }
            break;
          }
          case 'confirm':
            if (field === 'name') {
              setOsk({ label: t.name, value: draft.name, onCommit: (value) => setDraft((d) => ({ ...d, name: value })) });
            } else if (field === 'videoMusic') {
              setOsk({
                label: t.videoMusic,
                value: String(draft.videoMusicPct),
                onCommit: (value) =>
                  setDraft((d) => ({
                    ...d,
                    videoMusicPct: clampPercent(Number(value.replace(/\D/g, '') || 0)),
                  })),
              });
            } else if (field === 'backgroundOpacity') {
              setOsk({
                label: t.backgroundOpacity,
                value: String(draft.backgroundOpacity),
                onCommit: (value) =>
                  setDraft((d) => ({
                    ...d,
                    backgroundOpacity: clampPercent(Number(value.replace(/\D/g, '') || 0)),
                  })),
              });
            } else if (field === 'tags') {
              setOsk({
                label: t.addTag,
                value: '',
                onCommit: (value) => {
                  const tag = value.trim();
                  if (tag) setDraft((d) => (d.tags.includes(tag) ? d : { ...d, tags: [...d.tags, tag] }));
                },
              });
            } else if (field === 'submit') {
              void submitAlbum();
            }
            break;
          default:
            break;
        }
        return true;
      }

      return true;
    },
    [
      sheet, store.osk, store.addToAlbumFor, store.tagEditorFor, menu, viewerIndex, feed, nav,
      isAdmin, selectMode, setSelectMode, setNav, activateTop, recentAlbums.length,
      recentVisible, gearIndex, bumpLeftRow,
      bumpRightRow, confirmLeftRow, confirmRightRow, isMediaView, sections, cols, focusedItem,
      toggleSelection, openViewer, doAddToAlbum, doRemoveOrHide, view, albums, albumCols, openView,
      isForm, draft, setOsk, submitAlbum, settings.thumbSize, patchSettings, back, t, toast,
    ],
  );

  useInput(handle);

  // Clic droit : le menu contextuel du croquis, réservé aux gestes admin.
  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const tile = (event.target as HTMLElement).closest('[data-media]');
      if (!tile) return;
      event.preventDefault();
      const mediaId = Number(tile.getAttribute('data-media'));
      const item = feed.items.find((i) => i.id === mediaId);
      if (!item) return;
      setMenu({
        x: event.clientX,
        y: event.clientY,
        mediaId,
        inAlbum: view.kind === 'album' ? view.id : null,
        hidden: item.hidden,
        favorite: item.favorite,
      });
    },
    [feed.items, view],
  );

  // ------------------------------------------------------------- affichage

  const showLeft = nav.zone === 'left' || (nav.zone === 'top' && nav.topIndex === TOP.SEARCH);
  const showRight = nav.zone === 'right' || (nav.zone === 'top' && nav.topIndex === gearIndex);
  const viewerItem = viewerIndex !== null ? feed.items[viewerIndex] : undefined;
  const menuItem = menu ? feed.items.find((i) => i.id === menu.mediaId) : undefined;

  const stageTitle =
    view.kind === 'albums' ? t.albums
    : view.kind === 'videos' ? t.videos
    : view.kind === 'newAlbum' ? t.newAlbum
    : view.kind === 'editAlbum' ? t.editAlbum
    : currentAlbum ? (currentAlbum.kind === 'favorites' ? t.favorites : currentAlbum.name)
    : null;

  const scan = state?.scan;
  const scanning = scan?.running ?? false;
  const scanProgress =
    scan && scan.thumbsTotal > 0 ? scan.thumbsDone / scan.thumbsTotal : scanning ? 0.04 : 0;

  const noLibrary = (state?.roots.length ?? 0) === 0 && (state?.counts.photos ?? 0) === 0;

  return (
    <div className="app" onContextMenu={onContextMenu}>
      {backdrop && <div className="backdrop" style={{ backgroundImage: `url(${backdrop})` }} />}

      <TopBar
        recentAlbums={recentAlbums}
        recentOffset={recentOffset}
        recentVisible={recentVisible}
        onSlotsMeasured={setRecentSlots}
        onActivate={(index) => {
          setNav((n) => ({ ...n, zone: 'top', topIndex: index }));
          activateTop(index);
        }}
        onHover={(index) => setNav((n) => ({ ...n, zone: 'top', topIndex: index }))}
      />

      <div className="shell">
        {/* Gouttière toujours présente : la grille ne bouge pas quand la barre
            s'ouvre ou se ferme. */}
        <div className="gutter">
          {showLeft && (
            <SearchPanel
              onFocusRow={(row, sub) =>
                setNav((n) => ({ ...n, zone: 'left', panelIndex: row, subIndex: sub ?? 0 }))
              }
            />
          )}
        </div>

        <main className="stage">
          {currentAlbum?.background && (
            <div
              className="album-bg"
              style={{
                backgroundImage: `url(${api.backgroundUrl(currentAlbum.background)})`,
                opacity: currentAlbum.backgroundOpacity / 100,
              }}
            />
          )}

          {(stageTitle || filtersActive || isMediaView) && (
            <div className="stage-head">
              <span className="stage-title">{stageTitle ?? t.home}</span>
              {isMediaView && (
                <span className="stage-sub">
                  {view.kind === 'videos' ? t.videoCount(feed.total) : t.photoCount(feed.total)}
                  {filtersActive && ` · ${t.filtered}`}
                </span>
              )}
              {currentAlbum && currentAlbum.kind !== 'favorites' && isAdmin && !isForm && (
                <button
                  className="tiny-btn"
                  onClick={() => openView({ kind: 'editAlbum', id: currentAlbum.id })}
                >
                  <IconPencil /> {t.editAlbum}
                </button>
              )}

              {isMediaView && (
                <div className="head-toggle">
                  <button
                    className={settings.layout === 'day' ? 'on' : ''}
                    title={t.layoutDay}
                    aria-label={t.layoutDay}
                    onClick={() => patchSettings({ layout: 'day' })}
                  >
                    <IconRows />
                  </button>
                  <button
                    className={settings.layout === 'compact' ? 'on' : ''}
                    title={t.layoutCompact}
                    aria-label={t.layoutCompact}
                    onClick={() => patchSettings({ layout: 'compact' })}
                  >
                    <IconCompact />
                  </button>
                </div>
              )}

              {anchor !== null && (
                <button className="tiny-btn" onClick={() => setAnchor(null)}>
                  <IconX /> {t.today}
                </button>
              )}
            </div>
          )}

          <div
            className={`stage-scroll${isMediaView && buckets.length > 1 ? ' with-scrubber' : ''}`}
            ref={scrollRef}
          >
            {noLibrary && !scanning ? (
              <div className="empty">
                <span className="big">{t.noPhotosTitle}</span>
                <span>{t.noPhotosBody}</span>
                {isAdmin && (
                  <button className="btn primary" onClick={() => setSheet({ kind: 'folders' })}>
                    {t.addFolder}
                  </button>
                )}
              </div>
            ) : isMediaView ? (
              <Timeline
                feed={feed}
                inAlbum={view.kind === 'album'}
                onColumns={setCols}
                scrollRef={scrollRef}
                onAction={(item, kind) => {
                  const index = feed.items.findIndex((i) => i.id === item.id);
                  if (kind === 'open') {
                    if (selectMode) toggleSelection(item.id);
                    else openViewer(index);
                  } else if (kind === 'add') doAddToAlbum(item);
                  else void doRemoveOrHide(item);
                }}
              />
            ) : view.kind === 'albums' ? (
              <AlbumsRegion
                albums={albums}
                onCols={setAlbumCols}
                onOpen={(album) => openView({ kind: 'album', id: album.id })}
                onEdit={(album) => openView({ kind: 'editAlbum', id: album.id })}
              />
            ) : isForm ? (
              <AlbumForm
                title={view.kind === 'newAlbum' ? t.newAlbum : t.editAlbum}
                draft={draft}
                setDraft={setDraft}
                submitLabel={view.kind === 'newAlbum' ? t.create : t.save}
                onSubmit={() => void submitAlbum()}
                onCancel={back}
                onDelete={
                  view.kind === 'editAlbum'
                    ? () => {
                        if (!window.confirm(t.confirmDeleteAlbum)) return;
                        void api
                          .deleteAlbum(view.id)
                          .then(refresh)
                          .then(() => openView({ kind: 'albums' }));
                      }
                    : undefined
                }
              />
            ) : null}
          </div>

          {isMediaView && buckets.length > 1 && (
            <DateScrubber
              buckets={buckets}
              onPick={(month) => {
                const end = new Date(new Date(month).getFullYear(), new Date(month).getMonth() + 1, 0, 23, 59, 59, 999);
                setAnchor(end.getTime());
                scrollRef.current?.scrollTo({ top: 0 });
              }}
            />
          )}

          {selectMode && (
            <div className="selection-bar">
              <IconSelect />
              <span className="n">{t.selected(selection.length)}</span>
              <button
                className="tiny-btn"
                onClick={() => setSelection(feed.items.map((i) => i.id))}
              >
                {t.selectAll}
              </button>
              <button className="tiny-btn" onClick={() => doAddToAlbum()} disabled={selection.length === 0}>
                {t.addToAlbum}
              </button>
              <button
                className="tiny-btn danger"
                onClick={() => void doRemoveOrHide()}
                disabled={selection.length === 0}
              >
                {view.kind === 'album' ? t.removeFromAlbum : t.hide}
              </button>
              <button className="tiny-btn" onClick={() => setSelectMode(false)}>
                <IconX />
              </button>
            </div>
          )}

          {scanning && (
            <div className="scanbar">
              <i style={{ width: `${Math.round(scanProgress * 100)}%` }} />
            </div>
          )}
        </main>

        <div className="gutter">
          {showRight && (
            <SettingsPanel
              onFocusRow={(row, sub) =>
                setNav((n) => ({ ...n, zone: 'right', panelIndex: row, subIndex: sub ?? 0 }))
              }
            />
          )}
        </div>
      </div>

      <div className="status-line">
        {scanning ? (
          <>
            <span className="dot-live" />
            <span>
              {scan?.phase === 'thumbnails'
                ? `${t.thumbnails} ${scan.thumbsDone}/${scan.thumbsTotal}`
                : `${t.indexing} ${scan?.indexed ?? 0}`}
            </span>
          </>
        ) : (
          <span>
            {t.photoCount(state?.counts.photos ?? 0)} · {t.videoCount(state?.counts.videos ?? 0)}
            {isAdmin && (state?.counts.hidden ?? 0) > 0 && ` · ${state?.counts.hidden} ${t.hidden}`}
          </span>
        )}
        <span className="pad-hint">
          {pad.connected && <IconGamepad />}
          {pad.connected ? t.controls : 'Alt+S · ← → ↑ ↓ · Esc'}
        </span>
      </div>

      {currentAlbum && (
        <AlbumMusic
          slot={currentAlbum.musicSlot}
          // Dès qu'une vidéo est à l'écran, y compris avant qu'on la lance :
          // la musique ne saute pas de volume au moment où le son démarre.
          duckPct={viewerItem?.kind === 'video' ? currentAlbum.videoMusicPct : null}
        />
      )}

      {viewerItem && (
        <Viewer
          item={viewerItem}
          playing={viewerPlaying}
          showInfo={viewerInfo}
          onClose={() => {
            setViewerIndex(null);
            setViewerPlaying(false);
          }}
        />
      )}

      {menu && menuItem && (
        <ContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onOpen={() => {
            openViewer(feed.items.findIndex((i) => i.id === menu.mediaId));
            setMenu(null);
          }}
          onAddToAlbum={() => {
            doAddToAlbum(menuItem);
            setMenu(null);
          }}
          onToggleFavorite={() => {
            void toggleFavorite(menuItem);
            setMenu(null);
          }}
          onToggleHidden={() => {
            void doRemoveOrHide(menuItem);
            setMenu(null);
          }}
          onEditTags={() => {
            setTagEditorFor(selectMode && selection.length > 0 ? selection : [menu.mediaId]);
            setMenu(null);
          }}
          onSelectMode={() => {
            setSelectMode(true);
            setSelection([menu.mediaId]);
            setMenu(null);
          }}
          onRemoveFromAlbum={() => {
            if (menu.inAlbum !== null) {
              void api.albumMedia(menu.inAlbum, [menu.mediaId], true).then(() => {
                feed.dropItems([menu.mediaId]);
                void refresh();
              });
            }
            setMenu(null);
          }}
          onSetCover={() => {
            if (menu.inAlbum !== null) {
              void api.updateAlbum(menu.inAlbum, { coverMediaId: menu.mediaId }).then(refresh);
            }
            setMenu(null);
          }}
        />
      )}

      <MonthPickerSheet />
      <PlacePickerSheet />
      <TagPickerSheet />
      <AdminSheet />
      <FoldersSheet />
      <AddToAlbumSheet />
      <TagEditorSheet />
      <Osk />
      <Toasts />
    </div>
  );
}

/** La grille d'albums mesure ses colonnes pour que ↑/↓ sautent une vraie ligne. */
function AlbumsRegion({
  albums,
  onCols,
  onOpen,
  onEdit,
}: {
  albums: Album[];
  onCols: (n: number) => void;
  onOpen: (album: Album) => void;
  onEdit: (album: Album) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => onCols(Math.max(1, Math.floor((el.clientWidth + 14) / 204)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onCols]);

  return (
    <div ref={ref}>
      <AlbumsGrid albums={albums} onOpen={onOpen} onEdit={onEdit} />
    </div>
  );
}
