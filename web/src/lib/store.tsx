import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react';
import type { AppState, MediaQuery, Settings } from '../../../shared/types';
import { api } from './api';
import { dict } from './i18n';

export type View =
  | { kind: 'timeline' }
  | { kind: 'videos' }
  | { kind: 'albums' }
  | { kind: 'album'; id: number }
  | { kind: 'newAlbum' }
  | { kind: 'editAlbum'; id: number };

/** « head » = la rangée de boutons entre le titre et les photos. */
export type Zone = 'top' | 'head' | 'left' | 'right' | 'content';

export interface MonthValue {
  year: number;
  month: number; // 0-11
}

export interface Filters {
  from: MonthValue | null;
  to: MonthValue | null;
  place: string | null;
  /**
   * Tags demandés. Ils filtrent les photos dans la chronologie et dans un
   * album, et les albums eux-mêmes sur l'écran Albums : la barre de recherche
   * s'applique à ce qu'on a sous les yeux.
   */
  tags: string[];
  /** Recherche par nom, utilisée sur l'écran Albums. */
  text: string;
}

export interface Nav {
  zone: Zone;
  topIndex: number;
  panelIndex: number;
  headIndex: number;
  /** Champ courant à l'intérieur d'une rangée : [Jan] et [2026] par exemple. */
  subIndex: number;
  contentIndex: number;
}

export interface Toast {
  id: number;
  text: string;
}

/** Fenêtres modales ouvertes depuis les panneaux (le « carrousel » du croquis). */
export type Sheet =
  | { kind: 'folders' }
  | { kind: 'admin' }
  | { kind: 'monthPicker'; which: 'from' | 'to'; field: 'month' | 'year' }
  | { kind: 'placePicker' }
  | { kind: 'tagPicker' }
  | { kind: 'albumSort' }
  | { kind: 'upload' };

export interface OskRequest {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}

interface Store {
  state: AppState | null;
  refresh: () => Promise<void>;
  patchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: ReturnType<typeof dict>;

  view: View;
  openView: (view: View) => void;
  back: () => void;

  filters: Filters;
  setFilters: (update: (f: Filters) => Filters) => void;
  clearFilters: () => void;
  filtersActive: boolean;
  query: MediaQuery;

  /**
   * Mois actuellement en haut de la vue, pour le repère du curseur de dates.
   * C'est une position, pas un filtre : les photos plus récentes restent au-
   * dessus, il suffit de remonter.
   */
  anchor: number | null;
  setAnchor: (ts: number | null) => void;
  /** Mois vers lequel on veut se rendre. La chronologie y défile, sans filtrer. */
  seekMonth: number | null;
  setSeekMonth: (ts: number | null) => void;

  nav: Nav;
  setNav: (update: (n: Nav) => Nav) => void;
  /** Tag survolé dans le panneau de recherche, que LB/RB fait défiler. */
  tagCursor: number;
  setTagCursor: (n: number) => void;

  selectMode: boolean;
  setSelectMode: (on: boolean) => void;
  selection: number[];
  toggleSelection: (id: number) => void;
  setSelection: (ids: number[]) => void;

  addToAlbumFor: number[] | null;
  setAddToAlbumFor: (ids: number[] | null) => void;
  /**
   * Photos en attente d'un album qui n'existe pas encore : « Ajouter à un
   * album » → « Nouvel album » les met de côté, et la création les y verse.
   */
  pendingAlbumMedia: number[] | null;
  setPendingAlbumMedia: (ids: number[] | null) => void;
  /** Album dont on modifie les tags (clic droit sur sa carte). */
  albumTagsFor: number | null;
  setAlbumTagsFor: (id: number | null) => void;
  tagEditorFor: number[] | null;
  setTagEditorFor: (ids: number[] | null) => void;
  osk: OskRequest | null;
  setOsk: (req: OskRequest | null) => void;
  sheet: Sheet | null;
  setSheet: (sheet: Sheet | null) => void;

  accentHue: number;
  toast: (text: string) => void;
  toasts: Toast[];
}

const StoreContext = createContext<Store | null>(null);

const DEFAULT_SETTINGS: Settings = {
  fontScale: 2, hue: 285, volume: 3, lang: 'fr', showHidden: false,
  zoom: { timeline: 2, videos: 2, album: 2, albums: 2 },
  layout: 'day', albumSort: 'recent', uploadRequiresAdmin: false,
};

const EMPTY_FILTERS: Filters = { from: null, to: null, place: null, tags: [], text: '' };

function monthStart(v: MonthValue): number {
  return new Date(v.year, v.month, 1, 0, 0, 0, 0).getTime();
}

function monthEnd(v: MonthValue): number {
  return new Date(v.year, v.month + 1, 0, 23, 59, 59, 999).getTime();
}

export function StoreProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<AppState | null>(null);
  const [settings, setSettingsLocal] = useState<Settings>(DEFAULT_SETTINGS);
  const [view, setView] = useState<View>({ kind: 'timeline' });
  const [history, setHistory] = useState<View[]>([]);
  const [filters, setFiltersState] = useState<Filters>(EMPTY_FILTERS);
  const [anchor, setAnchor] = useState<number | null>(null);
  const [seekMonth, setSeekMonth] = useState<number | null>(null);
  const [nav, setNavState] = useState<Nav>({
    zone: 'content', topIndex: 1, panelIndex: 0, headIndex: 0, subIndex: 0, contentIndex: 0,
  });
  const [tagCursor, setTagCursor] = useState(0);
  const [selectMode, setSelectModeState] = useState(false);
  const [selection, setSelection] = useState<number[]>([]);
  const [addToAlbumFor, setAddToAlbumFor] = useState<number[] | null>(null);
  const [pendingAlbumMedia, setPendingAlbumMedia] = useState<number[] | null>(null);
  const [albumTagsFor, setAlbumTagsFor] = useState<number | null>(null);
  const [tagEditorFor, setTagEditorFor] = useState<number[] | null>(null);
  const [osk, setOsk] = useState<OskRequest | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const refresh = useCallback(async () => {
    const next = await api.state();
    setState(next);
    setSettingsLocal(next.settings);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Les réglages s'appliquent tout de suite à l'écran et partent au serveur en
  // arrière-plan : régler le volume ou la teinte ne doit jamais « accrocher ».
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    setSettingsLocal((prev) => {
      // `zoom` se met à jour un écran à la fois : sans fusion explicite, régler
      // le zoom des albums effacerait celui de la chronologie.
      const next: Settings = {
        ...prev,
        ...patch,
        zoom: { ...prev.zoom, ...(patch.zoom ?? {}) },
      };
      void api.saveSettings(patch).catch(() => {});
      return next;
    });
  }, []);

  const openView = useCallback((next: View) => {
    setView((current) => {
      setHistory((h) => (sameView(current, next) ? h : [...h, current].slice(-20)));
      return next;
    });
    setAnchor(null);
    setNavState((n) => ({ ...n, zone: 'content', contentIndex: 0 }));
  }, []);

  const back = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) {
        setView({ kind: 'timeline' });
        return h;
      }
      setView(h[h.length - 1]);
      return h.slice(0, -1);
    });
    setNavState((n) => ({ ...n, zone: 'content', contentIndex: 0 }));
  }, []);

  const setFilters = useCallback((update: (f: Filters) => Filters) => {
    setFiltersState(update);
    setAnchor(null);
  }, []);

  const clearFilters = useCallback(() => {
    setFiltersState(EMPTY_FILTERS);
    setAnchor(null);
  }, []);

  const setNav = useCallback((update: (n: Nav) => Nav) => setNavState(update), []);

  const toast = useCallback((text: string) => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 2600);
  }, []);

  const setSelectMode = useCallback((on: boolean) => {
    setSelectModeState(on);
    if (!on) setSelection([]);
  }, []);

  const toggleSelection = useCallback((id: number) => {
    setSelection((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  }, []);

  const filtersActive =
    filters.from !== null || filters.to !== null || filters.place !== null ||
    filters.tags.length > 0 || filters.text.trim() !== '';

  const query = useMemo<MediaQuery>(() => {
    const q: MediaQuery = {};
    if (filters.from) q.from = monthStart(filters.from);
    if (filters.to) q.to = monthEnd(filters.to);
    if (filters.place) q.place = filters.place;
    if (filters.tags.length) q.tags = filters.tags;
    if (settings.showHidden) q.showHidden = true;
    if (view.kind === 'videos') q.kind = 'video';
    if (view.kind === 'album') q.album = view.id;
    // Le curseur de dates ne filtre plus : il fait défiler. Sans quoi choisir
    // « mai 2020 » cachait tout ce qui était plus récent, alors qu'on voulait
    // seulement s'y rendre.
    return q;
  }, [filters, view, settings.showHidden]);

  const albumHue =
    view.kind === 'album'
      ? state?.albums.find((a) => a.id === view.id)?.color
      : view.kind === 'editAlbum'
        ? state?.albums.find((a) => a.id === view.id)?.color
        : undefined;

  const accentHue = albumHue ?? settings.hue;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--hue', String(accentHue));
    root.style.setProperty('--font-scale', String(0.86 + settings.fontScale * 0.09));
    root.lang = settings.lang;
  }, [accentHue, settings.fontScale, settings.lang]);

  const value: Store = {
    state, refresh, patchSettings, settings, t: dict(settings.lang),
    view, openView, back,
    filters, setFilters, clearFilters, filtersActive, query,
    anchor, setAnchor, seekMonth, setSeekMonth,
    nav, setNav, tagCursor, setTagCursor,
    selectMode, setSelectMode, selection, toggleSelection, setSelection,
    addToAlbumFor, setAddToAlbumFor, pendingAlbumMedia, setPendingAlbumMedia,
    albumTagsFor, setAlbumTagsFor, tagEditorFor, setTagEditorFor, osk, setOsk,
    sheet, setSheet,
    accentHue, toast, toasts,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

function sameView(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if ('id' in a && 'id' in b) return a.id === b.id;
  return true;
}

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore doit être utilisé dans <StoreProvider>');
  return store;
}
