import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Album, Chapter, DuplicateGroup, MediaItem, Mood, OnThisDay, ZoomKey,
} from '../../shared/types';
import { MOODS } from '../../shared/types';
import {
  AlbumForm, AlbumMusic, AlbumsGrid, albumFields, clampPercent, type AlbumDraft,
} from './components/Albums';
import {
  IconChild, IconCompact, IconDownload, IconGamepad, IconPencil, IconRows, IconSelect,
  IconSlideshow, IconSort, IconSparkle, IconX, IconZoomIn, IconZoomOut,
} from './components/Icons';
import { MemoriesView, chapterName } from './components/Memories';
import { Slideshow } from './components/Slideshow';
import {
  AddToAlbumSheet, AdminSheet, AlbumContextMenu, AlbumTagsSheet, ContextMenu, FoldersSheet,
  AlbumSortSheet, MonthPickerSheet, MoodPickerSheet, Osk, PlacePickerSheet, TagEditorSheet,
  TagPickerSheet, Toasts, type AlbumMenuTarget, type MenuTarget,
} from './components/Overlays';
import { SearchPanel, SettingsPanel, displayMonth, moodLabel } from './components/Panels';
import { UploadSheet } from './components/Upload';
import { DateScrubber, Timeline } from './components/Timeline';
import { TOP, TopBar, settingsIndex, topCount } from './components/TopBar';
import { Viewer } from './components/Viewer';
import { api } from './lib/api';
import { groupByDay, useHistogram, useMediaFeed, useMemories } from './lib/feed';
import {
  ALBUM_CARD_WIDTHS, buildCells, effectiveTile, moveFocus, spatialMove, ZOOM_MAX,
  type Direction,
} from './lib/grid';
import { LANGS } from './lib/i18n';
import { onPadStatus, startInput, useInput, type Action, type PadStatus } from './lib/input';
import {
  FONT_MAX, HUES, SCREENSAVER_MINUTES, SLIDE_SECONDS, VOLUME_MAX, leftRows, rightRows,
} from './lib/panels';
import { useStore } from './lib/store';

export function App(): React.JSX.Element {
  const store = useStore();
  const {
    state, refresh, settings, patchSettings, t, view, openView, back, filters, setFilters,
    clearFilters, filtersActive, query, anchor, setAnchor, seekMonth, setSeekMonth,
    nav, setNav, selectMode, setSelectMode,
    selection, setSelection, toggleSelection, setAddToAlbumFor, setTagEditorFor, setOsk,
    sheet, setSheet, toast, tagCursor, setTagCursor,
    pendingAlbumMedia, setPendingAlbumMedia, setAlbumTagsFor,
  } = store;

  const isAdmin = state?.isAdmin ?? false;
  /** Mode enfant actif, et cette session ne l'a pas quitté. */
  const isLocked = (state?.childMode ?? false) && !isAdmin;
  const albums = state?.albums ?? [];
  const favoritesAlbum = albums.find((a) => a.kind === 'favorites');
  const recentAlbums = useMemo(
    () => albums.filter((a) => a.kind !== 'favorites'),
    [albums],
  );

  const isMediaView = view.kind === 'timeline' || view.kind === 'videos' || view.kind === 'album';
  const isMemories = view.kind === 'memories';
  const isForm = view.kind === 'newAlbum' || view.kind === 'editAlbum';
  const formFields = albumFields(view.kind === 'editAlbum');

  // Chaque écran a son propre cran de zoom : agrandir les photos de l'accueil
  // ne doit pas gonfler les cartes de la grille d'albums.
  const zoomKey: ZoomKey =
    view.kind === 'albums' ? 'albums'
    : view.kind === 'album' ? 'album'
    : view.kind === 'videos' ? 'videos'
    : 'timeline';
  const zoom = settings.zoom[zoomKey] ?? 2;
  const setZoom = useCallback(
    (next: number) => patchSettings({ zoom: { [zoomKey]: Math.min(ZOOM_MAX, Math.max(0, next)) } as never }),
    [patchSettings, zoomKey],
  );

  const feed = useMediaFeed(query, isMediaView);
  const buckets = useHistogram(query, isMediaView);
  const sections = useMemo(() => groupByDay(feed.items), [feed.items]);
  // Les souvenirs se recalculent côté serveur : on les redemande quand la
  // bibliothèque a grossi, pas à chaque rendu.
  const memories = useMemories(isMemories, state?.counts.photos ?? 0, isAdmin);
  // L'écran Souvenirs se parcourt d'un bloc à la manette : les années, puis les
  // moments, puis les séries à trier.
  const memoryCount =
    memories.onThisDay.length + memories.chapters.length + memories.duplicates.length;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [cols, setCols] = useState(6);
  const [albumCols, setAlbumCols] = useState(4);
  const [recentOffset, setRecentOffset] = useState(0);
  const [recentSlots, setRecentSlots] = useState(2);
  const [memoryCols, setMemoryCols] = useState(3);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerPlaying, setViewerPlaying] = useState(false);
  const [viewerInfo, setViewerInfo] = useState(false);
  /**
   * Diaporama en cours. `items` figé = un moment ou une année de « ce jour-là » ;
   * `items` à null = on suit la chronologie affichée, qui continue de se charger.
   */
  const [show, setShow] = useState<
    { title: string | null; items: MediaItem[] | null; startIndex: number } | null
  >(null);
  const [showItem, setShowItem] = useState<MediaItem | undefined>(undefined);
  /** Dernier geste, pour le démarrage automatique après inactivité. */
  const lastActivity = useRef(Date.now());
  // Le flux d'avancement du scan est branché une fois pour toutes ; il lit l'état
  // du plein écran par référence plutôt que par fermeture, qui serait périmée.
  const viewerOpenRef = useRef(false);
  const pendingReload = useRef(false);
  const lastViewed = useRef<MediaItem | null>(null);
  // Mois visé dans le curseur de dates au stick droit. null = on ne vise rien.
  // Viser ne déplace pas la vue : il faut confirmer avec A.
  const [scrubAim, setScrubAim] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [albumMenu, setAlbumMenu] = useState<AlbumMenuTarget | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [pad, setPad] = useState<PadStatus>({ connected: false, id: null });
  const [draft, setDraft] = useState<AlbumDraft>({
    name: '', color: 285, musicSlot: null, videoMusicPct: 20,
    background: null, backgroundOpacity: 35, coverMediaId: null, tags: [],
  });

  // Nombre de tuiles d'albums récents réellement à l'écran : ce que la largeur
  // permet, borné par ce qui reste à afficher. Il décale l'index de la roue
  // dentée, donc toute la navigation de la barre du haut en dépend.
  // Boutons de l'en-tête : zoom seul sur la grille d'albums, zoom + disposition
  // sur les vues de photos. La navigation manette lit ce même compte.
  const headCount = isMediaView ? 4 : view.kind === 'albums' ? 3 : 0;
  const headFocus = nav.zone === 'head' ? Math.min(nav.headIndex, headCount - 1) : -1;

  const pressHead = useCallback(
    (index: number) => {
      if (index === 0) setZoom(zoom - 1);
      else if (index === 1) setZoom(zoom + 1);
      // Sur l'écran Albums, la 3e place est l'ordre de la grille ; ailleurs
      // c'est la bascule de disposition.
      else if (index === 2) {
        if (view.kind === 'albums') setSheet({ kind: 'albumSort' });
        else patchSettings({ layout: 'day' });
      } else if (index === 3) patchSettings({ layout: 'compact' });
    },
    [setZoom, zoom, patchSettings, view.kind, setSheet],
  );

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
          // Une photo est ouverte en plein écran : on ne rebâtit pas la
          // chronologie sous ses pieds. Les surveillances de dossiers font
          // finir un scan à n'importe quel moment, et la liste changeait de
          // longueur pendant qu'on regardait — d'où le clignotement, et
          // parfois une sortie pure et simple du plein écran.
          if (viewerOpenRef.current) pendingReload.current = true;
          else feed.reload();
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
        coverMediaId: currentAlbum.coverMediaId,
        tags: currentAlbum.tags,
      });
    }
    if (view.kind === 'newAlbum') {
      setDraft({
        name: '', color: settings.hue, musicSlot: null, videoMusicPct: 20,
        background: null, backgroundOpacity: 35, coverMediaId: null, tags: [],
      });
    }
  }, [view, currentAlbum, settings.hue]);

  // Formulaire quitté sans créer : les photos mises de côté sont oubliées,
  // sinon elles atterriraient dans le prochain album créé, des heures plus tard.
  useEffect(() => {
    if (view.kind !== 'newAlbum') setPendingAlbumMedia(null);
  }, [view.kind, setPendingAlbumMedia]);

  /**
   * Voyage vers le mois demandé. La chronologie se charge page par page en
   * partant du plus récent : on continue tant que ce mois n'est pas arrivé,
   * puis on le pose en haut de l'écran. Sans ça il fallait défiler à la main.
   */
  useEffect(() => {
    if (seekMonth === null) return;
    const container = scrollRef.current;
    if (!container) return;

    const d = new Date(seekMonth);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999).getTime();
    const reached = feed.items.some((item) => item.takenAt <= monthEnd);

    if (!reached && feed.hasMore) {
      if (!feed.loading) feed.loadMore();
      return;
    }

    // Le mois est chargé : on attend le rendu, puis on aligne sa section.
    const timer = window.setTimeout(() => {
      const target =
        container.querySelector<HTMLElement>(`[data-month="${seekMonth}"]`) ??
        // Mois vide : on se pose sur le premier plus ancien qui existe.
        [...container.querySelectorAll<HTMLElement>('[data-month]')].find(
          (node) => Number(node.dataset.month) <= seekMonth,
        );
      if (target) {
        const delta = target.getBoundingClientRect().top - container.getBoundingClientRect().top;
        container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
      }
      setSeekMonth(null);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [seekMonth, feed, setSeekMonth]);

  // ------------------------------------------------------------ actions

  /**
   * Albums réellement affichés. Sur l'écran Albums, la barre de recherche
   * filtre les albums plutôt que les photos : par tags — tous doivent être
   * présents, comme pour les photos — et par nom.
   */
  const visibleAlbums = useMemo(() => {
    const needle = filters.text.trim().toLowerCase();
    if (view.kind !== 'albums') return albums;
    return albums.filter((album) => {
      if (!filters.tags.every((tag) => album.tags.includes(tag))) return false;
      if (!needle) return true;
      const name = album.kind === 'favorites' ? t.favorites : album.name;
      return name.toLowerCase().includes(needle);
    });
  }, [albums, filters.tags, filters.text, view.kind, t.favorites]);

  const contentCount = isMediaView
    ? feed.items.length
    : view.kind === 'albums'
      ? visibleAlbums.length
      : isMemories
        ? memoryCount
        : isForm
          ? formFields.length
          : 0;

  const focusedItem: MediaItem | undefined = isMediaView ? feed.items[nav.contentIndex] : undefined;

  /**
   * Porte d'entrée unique des actions réservées à l'admin. Verrouillé, on ouvre
   * la demande de mot de passe au lieu de refuser en silence : c'est ce silence
   * qui donnait l'impression que les boutons avaient disparu.
   */
  const requireAdmin = useCallback((): boolean => {
    if (isAdmin) return true;
    toast(t.adminUnlockPrompt);
    setSheet({ kind: 'admin' });
    return false;
  }, [isAdmin, setSheet, t.adminUnlockPrompt, toast]);

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
      if (!requireAdmin()) return;
      setAddToAlbumFor(ids);
    },
    [targetIds, requireAdmin, setAddToAlbumFor],
  );

  /** X sur une photo : la retirer de l'album courant, ou la cacher ailleurs. */
  const doRemoveOrHide = useCallback(
    async (item?: MediaItem) => {
      const ids = targetIds(item);
      if (ids.length === 0) return;
      if (!requireAdmin()) return;
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
    [targetIds, requireAdmin, view, feed, settings.showHidden, selectMode, setSelection, refresh, t, toast],
  );

  const toggleFavorite = useCallback(
    async (item: MediaItem) => {
      if (!favoritesAlbum) return;
      if (!requireAdmin()) return;
      const ids = targetIds(item);
      await api.albumMedia(favoritesAlbum.id, ids, item.favorite);
      feed.patchItems(ids, { favorite: !item.favorite });
      await refresh();
    },
    [favoritesAlbum, requireAdmin, targetIds, feed, refresh],
  );

  const openViewer = useCallback((index: number) => {
    setViewerIndex(index);
    setViewerPlaying(false);
    setViewerInfo(false);
  }, []);

  /**
   * Tourne une photo d'un quart de tour. Le fichier d'origine n'est jamais
   * modifié : le serveur note l'angle et refait la vignette.
   */
  const doRotate = useCallback(
    async (item?: MediaItem) => {
      const ids = targetIds(item).filter((id) => {
        const found = feed.items.find((i) => i.id === id);
        return found?.kind === 'photo';
      });
      if (ids.length === 0) return;
      if (!requireAdmin()) return;
      await api.rotate(ids, 90);
      // On applique l'angle tout de suite à l'écran, sans attendre que le
      // serveur ait refait la vignette : l'angle fait partie de son URL, donc
      // la nouvelle image sera demandée dès qu'elle existe.
      for (const id of ids) {
        const current = feed.items.find((i) => i.id === id);
        if (current) feed.patchItems([id], { rotation: (current.rotation + 90) % 360 });
      }
      toast(t.rotated);
    },
    [targetIds, requireAdmin, feed, toast, t.rotated],
  );

  /**
   * Enregistrer une copie de la sélection. Une seule photo arrive telle quelle,
   * plusieurs dans un ZIP. C'est le navigateur qui mène le téléchargement : lui
   * seul sait afficher l'avancement et demander où ranger le fichier.
   *
   * Rien n'est déplacé ni effacé : les originaux restent à leur place sur le PC.
   */
  const doDownload = useCallback(
    (item?: MediaItem) => {
      const ids = targetIds(item);
      if (ids.length === 0) return;
      const link = document.createElement('a');
      link.href = api.downloadUrl(ids);
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast(t.downloadStarted);
    },
    [targetIds, toast, t.downloadStarted],
  );

  /**
   * La recherche par description part au serveur à part des autres filtres :
   * elle demande un calcul, pas une clause SQL. Son résultat vient remplir la
   * liste d'identifiants, et tout le reste de l'application s'applique dessus
   * sans rien savoir de CLIP.
   *
   * Une pause avant l'envoi : on ne veut pas d'une recherche par lettre tapée.
   */
  useEffect(() => {
    const query = filters.describe.trim();
    if (query === '') return;
    let annule = false;
    const timer = window.setTimeout(() => {
      void api
        .clipSearch(query)
        .then((r) => {
          if (!annule) {
            setFilters((f) => (f.describe.trim() === query ? { ...f, describeIds: r.ids } : f));
          }
        })
        .catch(() => {
          if (!annule) toast(t.describeFailed);
        });
    }, 350);
    return () => {
      annule = true;
      window.clearTimeout(timer);
    };
  }, [filters.describe, setFilters, toast, t.describeFailed]);

  /**
   * Le champ vidé à la main, les résultats s'en vont avec lui — sinon la
   * chronologie resterait coupée sans qu'on sache pourquoi. On ne touche pas à
   * une liste posée par le tri des doublons, qui n'a rien à voir.
   */
  const describeVide = filters.describe.trim() === '';
  useEffect(() => {
    if (describeVide) {
      setFilters((f) =>
        f.describe.trim() === '' && f.describeIds !== null ? { ...f, describeIds: null } : f);
    }
  }, [describeVide, setFilters]);

  // ------------------------------------------------------ diaporama

  /** Le diaporama de ce qui est à l'écran, à partir de la photo regardée. */
  const startSlideshow = useCallback(
    (startIndex: number) => {
      if (feed.items.length === 0) {
        toast(t.slideshowEmpty);
        return;
      }
      setViewerIndex(null);
      setViewerPlaying(false);
      // Le titre reste celui de l'écran d'où l'on part : il suit l'album ou le
      // filtre en cours, d'où le `null` plutôt qu'une copie figée.
      setShow({
        title: null,
        items: null,
        startIndex: Math.max(0, Math.min(feed.items.length - 1, startIndex)),
      });
    },
    [feed.items.length, toast, t.slideshowEmpty],
  );

  /** Le diaporama d'un moment : ses photos sont demandées d'un bloc au serveur. */
  const playChapter = useCallback(
    async (chapter: Chapter) => {
      const items = await api.mediaByIds(chapter.ids);
      if (items.length === 0) {
        toast(t.slideshowEmpty);
        return;
      }
      setShow({ title: chapterName(chapter, settings.lang), items, startIndex: 0 });
    },
    [settings.lang, toast, t.slideshowEmpty],
  );

  /** Le diaporama d'une année de « ce jour-là » : les photos sont déjà là. */
  const playDay = useCallback(
    (group: OnThisDay, startIndex: number) => {
      if (group.items.length === 0) return;
      setShow({
        title: `${t.onThisDay} · ${group.year}`,
        items: group.items,
        startIndex,
      });
    },
    [t.onThisDay],
  );

  /**
   * Prépare le tri d'une série de quasi-doublons : on revient à la chronologie
   * avec la série seule à l'écran, tout coché sauf la plus nette. Il ne reste
   * qu'à décocher ce qu'on veut garder et à appuyer sur « Cacher ».
   *
   * Rien n'est caché ni supprimé ici : c'est une sélection, pas une action.
   */
  const sortDuplicates = useCallback(
    (group: DuplicateGroup) => {
      if (!requireAdmin()) return;
      openView({ kind: 'timeline' });
      // Exactement la série, et rien d'autre : « ressemble à » en montrerait
      // davantage, et on se demanderait d'où sortent les photos en trop.
      setFilters(() => ({
        from: null, to: null, place: null, tags: [], text: '', mood: null,
        similar: null, ids: group.ids, describe: '', describeIds: null,
      }));
      setSelectMode(true);
      setSelection(group.ids.filter((id) => id !== group.bestId));
    },
    [requireAdmin, openView, setFilters, setSelectMode, setSelection],
  );

  /**
   * Fige un moment en album. Un moment n'existe qu'en mémoire et se redécoupera
   * au prochain ajout de photos ; en faire un album, c'est le garder pour de bon.
   */
  const makeAlbumFromChapter = useCallback(
    async (chapter: Chapter) => {
      if (!requireAdmin()) return;
      const name = chapterName(chapter, settings.lang);
      const { album } = await api.albumFromChapter(name, chapter.ids, settings.hue);
      await refresh();
      toast(t.momentSaved(album.name));
      openView({ kind: 'album', id: album.id });
    },
    [requireAdmin, settings.lang, settings.hue, refresh, toast, t, openView],
  );

  /**
   * Ne garder que ce qui ressemble à cette photo. C'est un filtre comme les
   * autres : la chronologie reste chronologique, le curseur de dates continue
   * de marcher, et la sélection multiple aussi. On voit la même scène au fil
   * des années, ce qu'un simple classement par ressemblance perdrait.
   */
  const doSimilar = useCallback(
    (item?: MediaItem) => {
      if (!item) return;
      openView({ kind: 'timeline' });
      // On repart d'une recherche vierge : garder une borne de dates ou un tag
      // par-dessus donnerait deux photos et l'air d'un bug.
      setFilters(() => ({
        from: null, to: null, place: null, tags: [], text: '', mood: null,
        similar: item.id, ids: null, describe: '', describeIds: null,
      }));
    },
    [openView, setFilters],
  );

  /**
   * Se rendre à un mois : on y *défile*, on ne filtre pas. Tout ce qui est plus
   * récent reste au-dessus, il suffit de remonter — avant, choisir « mai 2020 »
   * masquait tout le reste.
   */
  const pickMonth = useCallback((month: number) => setSeekMonth(month), [setSeekMonth]);

  /** Fermeture du plein écran : c'est là qu'on rattrape un scan mis en attente. */
  const closeViewer = useCallback(() => {
    setViewerIndex(null);
    setViewerPlaying(false);
    if (pendingReload.current) {
      pendingReload.current = false;
      feed.reload();
    }
  }, [feed]);

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
        case TOP.MEMORIES:
          openView({ kind: 'memories' });
          break;
        case TOP.NEW_ALBUM:
          if (requireAdmin()) openView({ kind: 'newAlbum' });
          break;
        case TOP.UPLOAD:
          setSheet({ kind: 'upload' });
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
    [setNav, openView, setSheet, favoritesAlbum, requireAdmin, recentAlbums, recentOffset, gearIndex],
  );

  const submitAlbum = useCallback(async () => {
    if (!draft.name.trim()) return;
    if (view.kind === 'newAlbum') {
      const album = await api.createAlbum(draft);
      // Album créé depuis « Ajouter à un album » : les photos mises de côté y
      // entrent tout de suite. On arrive donc dans un album déjà rempli.
      const waiting = pendingAlbumMedia ?? [];
      if (waiting.length > 0) {
        await api.albumMedia(album.id, waiting);
        toast(`${waiting.length} → ${album.name}`);
      }
      setPendingAlbumMedia(null);
      await refresh();
      openView({ kind: 'album', id: album.id });
    } else if (view.kind === 'editAlbum') {
      await api.updateAlbum(view.id, draft);
      await refresh();
      back();
    }
  }, [draft, view, refresh, openView, back, pendingAlbumMedia, setPendingAlbumMedia, toast]);

  // ------------------------------------------------- panneaux (valeurs -/+)

  // Rangées de la barre de recherche : celles des albums ou celles des photos.
  const searchRows = leftRows(view.kind === 'albums');

  const bumpLeftRow = useCallback(
    (delta: number) => {
      const row = searchRows[nav.panelIndex];
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
        return;
      }

      if (row.id === 'mood') {
        // « aucune » fait partie du tour : on doit pouvoir revenir en arrière
        // sans passer par le carrousel.
        const options: Array<Mood | null> = [null, ...MOODS];
        const index = options.indexOf(filters.mood);
        const next = (((index < 0 ? 0 : index) + delta) % options.length + options.length) % options.length;
        setFilters((f) => ({ ...f, mood: options[next] }));
      }
    },
    [searchRows, nav.panelIndex, nav.subIndex, state, filters, setFilters, tagCursor, setTagCursor],
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
        case 'slideshow': {
          // ←/→ ont choisi le champ ; LB/RB en changent la valeur.
          const cycle = (list: number[], current: number): number => {
            const i = list.indexOf(current);
            return list[(((i < 0 ? 0 : i) + delta) % list.length + list.length) % list.length];
          };
          if (nav.subIndex === 0) {
            patchSettings({ slideshowSeconds: cycle(SLIDE_SECONDS, settings.slideshowSeconds) });
          } else if (nav.subIndex === 1) {
            patchSettings({ slideshowShuffle: !settings.slideshowShuffle });
          } else if (nav.subIndex === 2) {
            patchSettings({ slideshowPan: !settings.slideshowPan });
          } else {
            patchSettings({
              screensaverMinutes: cycle(SCREENSAVER_MINUTES, settings.screensaverMinutes),
            });
          }
          break;
        }
        default:
          break;
      }
    },
    [isAdmin, nav.panelIndex, nav.subIndex, settings, patchSettings],
  );

  const confirmLeftRow = useCallback(() => {
    const row = searchRows[nav.panelIndex];
    if (!row) return;
    if (row.id === 'from' || row.id === 'to') {
      setSheet({
        kind: 'monthPicker',
        which: row.id,
        field: nav.subIndex === 0 ? 'month' : 'year',
      });
    } else if (row.id === 'place') setSheet({ kind: 'placePicker' });
    else if (row.id === 'mood') setSheet({ kind: 'moodPicker' });
    else if (row.id === 'describe') {
      setOsk({
        label: t.describe,
        value: filters.describe,
        onCommit: (value) => setFilters((f) => ({ ...f, describe: value })),
      });
    }
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
    } else if (row.id === 'name') {
      // Recherche par nom d'album : à la manette, A ouvre le clavier à l'écran.
      setOsk({
        label: t.albumName,
        value: filters.text,
        onCommit: (value) => setFilters((f) => ({ ...f, text: value })),
      });
    } else if (row.id === 'clear') clearFilters();
  }, [
    searchRows, nav.panelIndex, nav.subIndex, setSheet, state, tagCursor, setFilters, clearFilters,
    setOsk, t.albumName, filters.text, t.describe, filters.describe,
  ]);

  const confirmRightRow = useCallback(() => {
    const rows = rightRows(isAdmin);
    const row = rows[nav.panelIndex];
    if (!row) return;
    if (row.id === 'admin') setSheet({ kind: 'admin' });
    else if (row.id === 'folders') setSheet({ kind: 'folders' });
    else if (row.id === 'lang') patchSettings({ lang: LANGS[nav.subIndex]?.code ?? settings.lang });
    else if (row.id === 'hidden') patchSettings({ showHidden: !settings.showHidden });
    // Sur le diaporama, A fait la même chose qu'un clic sur le champ visé.
    else bumpRightRow(1);
  }, [isAdmin, nav.panelIndex, nav.subIndex, setSheet, patchSettings, settings, bumpRightRow]);

  // ------------------------------------------------------ gestion centrale

  const handle = useCallback(
    (action: Action): boolean => {
      // Tout geste repousse le démarrage automatique du diaporama.
      lastActivity.current = Date.now();

      // Une surcouche est ouverte : elle a son propre gestionnaire, plus bas
      // dans la pile. On décline pour lui laisser la main. Il faut le dire
      // explicitement : ce gestionnaire-ci est réinscrit à chaque fois que ses
      // dépendances changent, donc il repasse en tête de pile même quand la
      // surcouche s'est montée après lui.
      if (
        show || sheet || store.osk || store.addToAlbumFor || store.tagEditorFor ||
        store.albumTagsFor
      ) {
        return false;
      }

      // Start lance le diaporama de ce qu'on regarde, depuis la photo visée.
      // Le diaporama, lui, gère lui-même Start pour en sortir.
      if (action === 'start') {
        if (isMediaView) startSlideshow(viewerIndex ?? nav.contentIndex);
        else openView({ kind: 'memories' });
        return true;
      }

      if (menu) {
        if (action === 'back') setMenu(null);
        return true;
      }

      if (albumMenu) {
        if (action === 'back') setAlbumMenu(null);
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
            closeViewer();
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
          case 'rotate':
            // RS tourne la photo affichée d'un quart de tour.
            void doRotate(item);
            break;
          case 'setCover':
            // LS désigne la photo affichée comme couverture de l'album courant.
            if (view.kind === 'album' && item && requireAdmin()) {
              void api
                .updateAlbum(view.id, { coverMediaId: item.id })
                .then(refresh)
                .then(() => toast(t.coverSet));
            }
            break;
          default:
            break;
        }
        return true;
      }

      // ---- curseur de dates au stick droit
      // Viser est sans effet sur la vue : rien ne bouge tant que A n'a pas
      // confirmé. B (ou Échap) abandonne et laisse la chronologie où elle est.
      const scrubCount = isMediaView ? buckets.length : 0;
      if (action === 'scrubPrev' || action === 'scrubNext') {
        if (scrubCount < 2) return true;
        const delta = action === 'scrubNext' ? 1 : -1;
        setScrubAim((prev) => {
          // Premier mouvement : on démarre au mois actuellement affiché.
          const from =
            prev ?? Math.max(0, buckets.findIndex((b) => anchor !== null && anchor >= b.month));
          return Math.min(scrubCount - 1, Math.max(0, from + delta));
        });
        return true;
      }

      if (scrubAim !== null) {
        if (action === 'confirm') {
          const bucket = buckets[scrubAim];
          if (bucket) pickMonth(bucket.month);
          setScrubAim(null);
          return true;
        }
        if (action === 'back') {
          setScrubAim(null);
          return true;
        }
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
            // La rangée de boutons de l'en-tête s'intercale entre la barre du
            // haut et les photos : on y passe avant d'atteindre la grille.
            else if (headCount > 0) setNav((n) => ({ ...n, zone: 'head', headIndex: 0 }));
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

      // ---- rangée de boutons de l'en-tête
      if (nav.zone === 'head') {
        switch (action) {
          case 'left':
            setNav((n) => ({ ...n, headIndex: Math.max(0, n.headIndex - 1) }));
            break;
          case 'right':
            setNav((n) => ({ ...n, headIndex: Math.min(headCount - 1, n.headIndex + 1) }));
            break;
          case 'up':
            setNav((n) => ({ ...n, zone: 'top' }));
            break;
          case 'down':
          case 'back':
            setNav((n) => ({ ...n, zone: 'content' }));
            break;
          case 'confirm':
            pressHead(headFocus);
            break;
          case 'dec':
            setZoom(zoom - 1);
            break;
          case 'inc':
            setZoom(zoom + 1);
            break;
          default:
            break;
        }
        return true;
      }

      // ---- barres verticales
      if (nav.zone === 'left' || nav.zone === 'right') {
        const rows = nav.zone === 'left' ? searchRows : rightRows(isAdmin);
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
        case 'inc':
          if (!isForm) setZoom(zoom + (action === 'inc' ? -1 : 1));
          break;
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
            if (next < 0) setNav((n) => ({ ...n, zone: headCount > 0 ? 'head' : 'top', topIndex: TOP.HOME }));
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

      if (isMemories) {
        // L'écran est fait de deux régions : les années de « ce jour-là », une
        // par ligne, puis la grille des moments. ↑/↓ saute d'une ligne dans
        // chacune, et passe de l'une à l'autre à la frontière.
        const dayCount = memories.onThisDay.length;
        const momentEnd = dayCount + memories.chapters.length;
        const clamp = (n: number): number => Math.min(memoryCount - 1, Math.max(0, n));
        const move = (delta: number): void =>
          setNav((n) => ({ ...n, contentIndex: clamp(n.contentIndex + delta) }));
        const index = Math.min(nav.contentIndex, memoryCount - 1);
        const inDays = index < dayCount;
        // Les séries de doublons sont empilées, une par ligne comme les années.
        const inDuplicates = index >= momentEnd;

        switch (action) {
          case 'left': move(-1); break;
          case 'right': move(1); break;
          case 'down':
            move(inDays || inDuplicates ? 1 : memoryCols);
            break;
          case 'up':
            // Depuis la première ligne des moments, on remonte dans les années ;
            // depuis la première année, on rend la main à la barre du haut.
            if (index === 0) setNav((n) => ({ ...n, zone: 'top', topIndex: TOP.MEMORIES }));
            else if (inDuplicates) move(-1);
            else if (index - memoryCols < dayCount) {
              setNav((n) => ({ ...n, contentIndex: clamp(Math.max(0, dayCount - 1)) }));
            } else move(inDays ? -1 : -memoryCols);
            break;
          case 'confirm': {
            if (inDays) {
              const group = memories.onThisDay[index];
              if (group) playDay(group, 0);
            } else if (inDuplicates) {
              // Sur une série, A prépare le tri : rien ne se cache tout seul.
              const dup = memories.duplicates[index - momentEnd];
              if (dup) sortDuplicates(dup);
            } else {
              const chapter = memories.chapters[index - dayCount];
              if (chapter) void playChapter(chapter);
            }
            break;
          }
          case 'actionY': {
            // Y fige le moment visé en album, comme Y ouvre la fiche d'un album.
            const chapter = inDays || inDuplicates ? undefined : memories.chapters[index - dayCount];
            if (chapter) void makeAlbumFromChapter(chapter);
            break;
          }
          default:
            break;
        }
        return true;
      }

      if (view.kind === 'albums') {
        // La navigation suit la grille filtrée : un album masqué par la
        // recherche ne doit pas rester atteignable à la manette.
        const move = (delta: number): void =>
          setNav((n) => ({
            ...n,
            contentIndex: Math.min(visibleAlbums.length - 1, Math.max(0, n.contentIndex + delta)),
          }));
        switch (action) {
          case 'left': move(-1); break;
          case 'right': move(1); break;
          case 'down': move(albumCols); break;
          case 'up':
            if (nav.contentIndex < albumCols) setNav((n) => ({ ...n, zone: headCount > 0 ? 'head' : 'top', topIndex: TOP.ALBUMS }));
            else move(-albumCols);
            break;
          case 'confirm': {
            const album = visibleAlbums[nav.contentIndex];
            if (album) openView({ kind: 'album', id: album.id });
            break;
          }
          case 'actionX': {
            // X sur un album : ses tags, sans passer par la fiche complète.
            const album = visibleAlbums[nav.contentIndex];
            if (album && requireAdmin()) setAlbumTagsFor(album.id);
            break;
          }
          case 'actionY': {
            const album = visibleAlbums[nav.contentIndex];
            if (album && album.kind !== 'favorites' && isAdmin) openView({ kind: 'editAlbum', id: album.id });
            break;
          }
          default:
            break;
        }
        return true;
      }

      if (isForm) {
        const field = formFields[nav.contentIndex];
        switch (action) {
          case 'up':
            if (nav.contentIndex === 0) setNav((n) => ({ ...n, zone: 'top', topIndex: TOP.NEW_ALBUM }));
            else setNav((n) => ({ ...n, contentIndex: n.contentIndex - 1 }));
            break;
          case 'down':
            setNav((n) => ({
              ...n,
              contentIndex: Math.min(formFields.length - 1, n.contentIndex + 1),
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
      show, sheet, store.osk, store.addToAlbumFor, store.tagEditorFor, store.albumTagsFor,
      menu, albumMenu, setAlbumTagsFor, visibleAlbums, viewerIndex, feed, nav,
      isAdmin, selectMode, setSelectMode, setNav, activateTop, recentAlbums.length,
      recentVisible, gearIndex, bumpLeftRow,
      bumpRightRow, confirmLeftRow, confirmRightRow, isMediaView, sections, cols, focusedItem,
      toggleSelection, openViewer, closeViewer, doAddToAlbum, doRemoveOrHide, view, albums, albumCols, openView,
      buckets, anchor, scrubAim, pickMonth,
      isForm, draft, setOsk, submitAlbum, zoom, setZoom, headCount, headFocus, pressHead,
      patchSettings, back, refresh,
      isMemories, memories, memoryCount, memoryCols, playDay, playChapter, makeAlbumFromChapter,
      sortDuplicates,
      startSlideshow,
      formFields, t, toast,
    ],
  );

  useInput(handle);

  // Souris et clavier repoussent eux aussi le démarrage automatique : sans ça,
  // le diaporama se lancerait pendant qu'on trie tranquillement ses photos.
  useEffect(() => {
    const touch = (): void => {
      lastActivity.current = Date.now();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
    };
  }, []);

  /**
   * Démarrage automatique après un long silence : l'écran devient un cadre
   * photo. Désactivé par défaut, et jamais pendant qu'une fenêtre est ouverte
   * ou qu'on remplit un formulaire — on ne coupe la parole à personne.
   */
  useEffect(() => {
    const minutes = settings.screensaverMinutes;
    if (minutes <= 0 || show !== null) return;
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current < minutes * 60_000) return;
      if (sheet || store.osk || isForm || feed.items.length === 0) return;
      setShow({ title: null, items: null, startIndex: 0 });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [settings.screensaverMinutes, show, sheet, store.osk, isForm, feed.items.length]);

  // Clic droit : le menu contextuel du croquis, réservé aux gestes admin.
  const onContextMenu = useCallback(
    (event: React.MouseEvent) => {
      // Une carte d'album a son propre menu : ses tags, sa fiche.
      const card = (event.target as HTMLElement).closest('[data-album]');
      if (card) {
        event.preventDefault();
        setAlbumMenu({
          x: event.clientX,
          y: event.clientY,
          albumId: Number(card.getAttribute('data-album')),
        });
        return;
      }

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
        kind: item.kind,
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
  // Tant que le plein écran est ouvert, il affiche quelque chose. Si la
  // chronologie se recharge sous lui, on garde la dernière photo connue plutôt
  // que de laisser un trou d'un rendu : c'est ce trou qu'on voyait clignoter.
  const liveItem = viewerIndex !== null ? feed.items[viewerIndex] : undefined;
  const viewerItem = viewerIndex === null ? undefined : (liveItem ?? lastViewed.current ?? undefined);
  const menuItem = menu ? feed.items.find((i) => i.id === menu.mediaId) : undefined;

  useEffect(() => {
    if (liveItem) lastViewed.current = liveItem;
  }, [liveItem]);

  useEffect(() => {
    viewerOpenRef.current = viewerIndex !== null;
  }, [viewerIndex]);

  // Le mois visé n'a plus de sens hors d'une vue de photos, ni derrière le
  // plein écran, ni si la liste des mois a raccourci entre-temps.
  useEffect(() => {
    setScrubAim((prev) => {
      if (prev === null) return null;
      if (!isMediaView || viewerIndex !== null) return null;
      return prev < buckets.length ? prev : null;
    });
  }, [isMediaView, viewerIndex, buckets.length]);

  // La liste a bougé (import, masquage, rechargement) : on retrouve la photo
  // regardée par son identifiant, pour que la flèche suivante reparte d'elle.
  useEffect(() => {
    if (viewerIndex === null || liveItem) return;
    const id = lastViewed.current?.id;
    if (id === undefined) return;
    const found = feed.items.findIndex((i) => i.id === id);
    if (found >= 0 && found !== viewerIndex) setViewerIndex(found);
  }, [feed.items, liveItem, viewerIndex]);

  const stageTitle =
    view.kind === 'albums' ? t.albums
    : view.kind === 'videos' ? t.videos
    : view.kind === 'memories' ? t.memories
    : view.kind === 'newAlbum' ? t.newAlbum
    : view.kind === 'editAlbum' ? t.editAlbum
    : currentAlbum ? (currentAlbum.kind === 'favorites' ? t.favorites : currentAlbum.name)
    : null;

  // Le diaporama qui suit la chronologie affiche les photos chargées ; celui
  // d'un moment porte sa propre liste, figée au moment du lancement.
  const showItems = show?.items ?? feed.items;

  // Nom de la photo servant de référence aux « photos semblables ». Elle fait
  // partie des résultats, donc on le trouve sans requête supplémentaire.
  const similarName =
    filters.similar === null
      ? null
      : (feed.items.find((i) => i.id === filters.similar)?.filename ?? null);

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
        {/* Les barres se posent par-dessus la grille : les photos gardent toute
            la largeur et ne se décalent jamais. */}
        {showLeft && (
          <SearchPanel
            onFocusRow={(row, sub) =>
              setNav((n) => ({ ...n, zone: 'left', panelIndex: row, subIndex: sub ?? 0 }))
            }
          />
        )}

        <main
          className="stage"
          // Un clic dans la vue principale referme la barre ouverte. Seule la
          // chronologie le faisait, par accident : ses tuiles reprennent le
          // focus. Ailleurs — grille d'albums, formulaire — rien ne le prenait,
          // et la barre restait posée sur l'écran.
          onPointerDown={() => {
            if (showLeft || showRight) setNav((n) => ({ ...n, zone: 'content' }));
          }}
        >
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

              {/* Deux filtres qui ne vivent pas dans la barre de recherche : on
                  les montre ici, avec de quoi les retirer d'un clic. Sans ça on
                  ne saurait pas pourquoi la chronologie est si courte. */}
              {isMediaView && filters.similar !== null && (
                <button
                  className="filter-chip"
                  onClick={() => setFilters((f) => ({ ...f, similar: null }))}
                  title={t.clearFilters}
                >
                  <IconSparkle />
                  {similarName ? t.similarTo(similarName) : t.similar}
                  <IconX />
                </button>
              )}
              {isMediaView && filters.describe.trim() !== '' && (
                <button
                  className="filter-chip"
                  onClick={() => setFilters((f) => ({ ...f, describe: '', describeIds: null }))}
                  title={t.clearFilters}
                >
                  <IconSparkle />
                  {`« ${filters.describe.trim()} » · ${t.describeResults(feed.total)}`}
                  <IconX />
                </button>
              )}
              {isMediaView && filters.describe.trim() === '' && filters.ids !== null && (
                <button
                  className="filter-chip"
                  onClick={() => setFilters((f) => ({ ...f, ids: null }))}
                  title={t.clearFilters}
                >
                  <IconSparkle />
                  {t.duplicateGroup(filters.ids.length)}
                  <IconX />
                </button>
              )}
              {isMediaView && filters.mood !== null && (
                <button
                  className="filter-chip"
                  onClick={() => setFilters((f) => ({ ...f, mood: null }))}
                  title={t.clearFilters}
                >
                  {moodLabel(filters.mood, t)}
                  <IconX />
                </button>
              )}
              {currentAlbum && currentAlbum.kind !== 'favorites' && !isForm && (
                <button
                  className="tiny-btn"
                  onClick={() => {
                    if (requireAdmin()) openView({ kind: 'editAlbum', id: currentAlbum.id });
                  }}
                >
                  <IconPencil /> {t.editAlbum}
                </button>
              )}

              {(isMediaView || view.kind === 'albums') && (
                <div className="head-toggle">
                  <button
                    className={headFocus === 0 ? 'on' : ''}
                    title={t.zoomOut}
                    aria-label={t.zoomOut}
                    disabled={zoom === 0}
                    onClick={() => setZoom(zoom - 1)}
                  >
                    <IconZoomOut />
                  </button>
                  <button
                    className={headFocus === 1 ? 'on' : ''}
                    title={t.zoomIn}
                    aria-label={t.zoomIn}
                    disabled={zoom === ZOOM_MAX}
                    onClick={() => setZoom(zoom + 1)}
                  >
                    <IconZoomIn />
                  </button>
                  {view.kind === 'albums' && (
                    <>
                      <span className="head-sep" />
                      <button
                        className={headFocus === 2 ? 'on' : ''}
                        title={t.sortAlbums}
                        aria-label={t.sortAlbums}
                        onClick={() => setSheet({ kind: 'albumSort' })}
                      >
                        <IconSort />
                      </button>
                    </>
                  )}
                  {isMediaView && (
                    <>
                      <span className="head-sep" />
                      <button
                        className={`${settings.layout === 'day' ? 'active ' : ''}${headFocus === 2 ? 'on' : ''}`}
                        title={t.layoutDay}
                        aria-label={t.layoutDay}
                        onClick={() => patchSettings({ layout: 'day' })}
                      >
                        <IconRows />
                      </button>
                      <button
                        className={`${settings.layout === 'compact' ? 'active ' : ''}${headFocus === 3 ? 'on' : ''}`}
                        title={t.layoutCompact}
                        aria-label={t.layoutCompact}
                        onClick={() => patchSettings({ layout: 'compact' })}
                      >
                        <IconCompact />
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Le diaporama part de ce qui est à l'écran : la chronologie, un
                  album, les vidéos — filtres compris. */}
              {isMediaView && feed.items.length > 0 && (
                <button className="tiny-btn" onClick={() => startSlideshow(nav.contentIndex)}>
                  <IconSlideshow /> {t.slideshow}
                </button>
              )}

              {/* Remonter d'un geste : le curseur de dates ne filtre plus, donc
                  ce bouton ramène en haut au lieu d'effacer une borne. */}
              {isMediaView && anchor !== null && buckets.length > 1 && anchor !== buckets[0]?.month && (
                <button
                  className="tiny-btn"
                  onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                >
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
                zoom={zoom}
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
            ) : isMemories ? (
              <MemoriesView
                data={memories}
                focusIndex={nav.zone === 'content' ? Math.min(nav.contentIndex, memoryCount - 1) : -1}
                onFocus={(index) => setNav((n) => ({ ...n, zone: 'content', contentIndex: index }))}
                onPlayDay={playDay}
                onPlayChapter={(chapter) => void playChapter(chapter)}
                onMakeAlbum={(chapter) => void makeAlbumFromChapter(chapter)}
                onCols={setMemoryCols}
                onSortDuplicates={sortDuplicates}
              />
            ) : view.kind === 'albums' && visibleAlbums.length === 0 ? (
              // Une recherche sans résultat renvoyait une page blanche, sans dire
              // que c'est le filtre qui vide la grille.
              <div className="empty">
                <span className="big">{t.noAlbumMatch}</span>
                <button className="btn primary" onClick={clearFilters}>
                  {t.clearFilters}
                </button>
              </div>
            ) : view.kind === 'albums' ? (
              <AlbumsRegion
                albums={visibleAlbums}
                cardWidth={ALBUM_CARD_WIDTHS[zoom] ?? ALBUM_CARD_WIDTHS[2]}
                onCols={setAlbumCols}
                onOpen={(album) => openView({ kind: 'album', id: album.id })}
                onEdit={(album) => {
                  if (requireAdmin()) openView({ kind: 'editAlbum', id: album.id });
                }}
              />
            ) : isForm ? (
              <AlbumForm
                title={view.kind === 'newAlbum' ? t.newAlbum : t.editAlbum}
                draft={draft}
                setDraft={setDraft}
                albumId={view.kind === 'editAlbum' ? view.id : undefined}
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
            <DateScrubber buckets={buckets} aim={scrubAim} onPick={pickMonth} />
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
              {/* Une copie sur l'appareil qui regarde. Les originaux ne bougent
                  pas : c'est un téléchargement, pas un déplacement. */}
              <button
                className="tiny-btn"
                title={t.downloadHint}
                onClick={() => doDownload()}
                disabled={selection.length === 0}
              >
                <IconDownload /> {t.download}
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

        {showRight && (
          <SettingsPanel
            onFocusRow={(row, sub) =>
              setNav((n) => ({ ...n, zone: 'right', panelIndex: row, subIndex: sub ?? 0 }))
            }
          />
        )}
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
        {/* Le mode enfant se voit en permanence : on doit savoir d'un coup
            d'oeil si l'application est bridée, et pouvoir en sortir d'ici. */}
        {(state?.childMode ?? false) && (
          <button
            className={`lock-chip${isAdmin ? ' unlocked' : ''}`}
            onClick={() => setSheet({ kind: 'admin' })}
            title={isAdmin ? t.childModeOnUnlocked : t.endChildModeHint}
          >
            <IconChild /> {t.childMode}
          </button>
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
          // Le diaporama lance ses vidéos tout seul, d'où le second cas.
          duckPct={
            (show ? showItem : viewerItem)?.kind === 'video' ? currentAlbum.videoMusicPct : null
          }
        />
      )}

      {viewerItem && !show && (
        <Viewer
          item={viewerItem}
          playing={viewerPlaying}
          showInfo={viewerInfo}
          onClose={closeViewer}
        />
      )}

      {show && (
        <Slideshow
          items={showItems}
          startIndex={show.startIndex}
          title={show.title ?? stageTitle ?? t.home}
          // Un diaporama lancé sur la chronologie doit pouvoir dépasser les
          // photos déjà chargées : il redemande la suite en approchant du bout.
          onNeedMore={show.items === null ? feed.loadMore : undefined}
          onItem={setShowItem}
          onClose={() => {
            setShow(null);
            setShowItem(undefined);
            lastActivity.current = Date.now();
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
            if (!requireAdmin()) return;
            setTagEditorFor(selectMode && selection.length > 0 ? selection : [menu.mediaId]);
            setMenu(null);
          }}
          onSelectMode={() => {
            setSelectMode(true);
            setSelection([menu.mediaId]);
            setMenu(null);
          }}
          onRemoveFromAlbum={() => {
            if (menu.inAlbum !== null && requireAdmin()) {
              void api.albumMedia(menu.inAlbum, [menu.mediaId], true).then(() => {
                feed.dropItems([menu.mediaId]);
                void refresh();
              });
            }
            setMenu(null);
          }}
          onSetCover={() => {
            if (menu.inAlbum !== null && requireAdmin()) {
              void api.updateAlbum(menu.inAlbum, { coverMediaId: menu.mediaId }).then(refresh);
            }
            setMenu(null);
          }}
          onRotate={() => {
            void doRotate(menuItem);
            setMenu(null);
          }}
          onDownload={() => {
            doDownload(menuItem);
            setMenu(null);
          }}
          onSimilar={() => {
            doSimilar(menuItem);
            setMenu(null);
          }}
        />
      )}

      {albumMenu && (
        <AlbumContextMenu
          target={albumMenu}
          onClose={() => setAlbumMenu(null)}
          onOpen={() => {
            openView({ kind: 'album', id: albumMenu.albumId });
            setAlbumMenu(null);
          }}
          onEdit={() => {
            if (requireAdmin()) openView({ kind: 'editAlbum', id: albumMenu.albumId });
            setAlbumMenu(null);
          }}
          onEditTags={() => {
            if (requireAdmin()) setAlbumTagsFor(albumMenu.albumId);
            setAlbumMenu(null);
          }}
          onTogglePin={() => {
            const album = albums.find((a) => a.id === albumMenu.albumId);
            if (album && requireAdmin()) {
              void api.updateAlbum(album.id, { pinned: !album.pinned }).then(refresh);
            }
            setAlbumMenu(null);
          }}
        />
      )}

      <UploadSheet />
      <MonthPickerSheet />
      <PlacePickerSheet />
      <TagPickerSheet />
      <MoodPickerSheet />
      <AdminSheet />
      <FoldersSheet />
      <AddToAlbumSheet />
      <TagEditorSheet />
      <AlbumTagsSheet />
      <AlbumSortSheet />
      <Osk />
      <Toasts />
    </div>
  );
}

/** La grille d'albums mesure ses colonnes pour que ↑/↓ sautent une vraie ligne. */
function AlbumsRegion({
  albums,
  cardWidth,
  onCols,
  onOpen,
  onEdit,
}: {
  albums: Album[];
  cardWidth: number;
  onCols: (n: number) => void;
  onOpen: (album: Album) => void;
  onEdit: (album: Album) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => {
      const width = el.clientWidth;
      const card = effectiveTile(cardWidth, width);
      el.style.setProperty('--album-card-w', `${card}px`);
      onCols(Math.max(1, Math.floor((width + 14) / (card + 14))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onCols, cardWidth]);

  return (
    <div ref={ref}>
      <AlbumsGrid albums={albums} onOpen={onOpen} onEdit={onEdit} />
    </div>
  );
}
