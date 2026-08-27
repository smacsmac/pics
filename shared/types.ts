// Types partagés entre le serveur et l'interface.

export type MediaKind = 'photo' | 'video';
export type Lang = 'en' | 'fr' | 'ko';

export interface MediaItem {
  id: number;
  kind: MediaKind;
  filename: string;
  takenAt: number; // epoch ms
  takenSource: 'exif' | 'filename' | 'mtime';
  width: number | null;
  height: number | null;
  duration: number | null; // secondes, vidéos
  bytes: number;
  place: string | null; // « Hamilton, Ontario, Canada »
  city: string | null;
  camera: string | null;
  hidden: boolean;
  favorite: boolean;
  /** Tags posés sur la photo elle-même : les seuls qu'on puisse lui retirer. */
  tags: string[];
  /**
   * Tags hérités des albums qui contiennent cette photo. Ils comptent dans les
   * recherches au même titre que les siens, mais s'enlèvent sur l'album, pas
   * sur la photo — d'où la liste séparée.
   */
  albumTags: string[];
  /** Rotation d'affichage en degrés (0, 90, 180, 270). Le fichier reste intact. */
  rotation: number;
}

export interface Album {
  id: number;
  name: string;
  color: number; // teinte 0-359
  musicSlot: number | null; // 1..5
  /** Volume de la musique pendant une vidéo, en % du volume global (0-100). */
  videoMusicPct: number;
  /** Nom du fichier d'arrière-plan, dans le dossier d'images d'interface. */
  background: string | null;
  /** Opacité de cet arrière-plan, en pourcentage (0-100). */
  backgroundOpacity: number;
  coverMediaId: number | null;
  /** Épinglé : l'album passe en tête de la grille, avant le tri courant. */
  pinned: boolean;
  kind: 'user' | 'favorites';
  count: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Chaque écran garde son propre niveau de zoom : agrandir les photos de la
 * chronologie ne doit pas gonfler les tuiles de la grille d'albums.
 */
export type ZoomKey = 'timeline' | 'videos' | 'album' | 'albums';
export type ZoomLevels = Record<ZoomKey, number>;

/**
 * Ordres possibles pour la grille d'albums. « yearDesc » et « yearAsc » lisent
 * l'année écrite dans le nom (« Vacances 2026 »), ce qui correspond à la façon
 * dont les albums sont nommés en pratique.
 */
export type AlbumSort = 'recent' | 'name' | 'yearDesc' | 'yearAsc';

export interface Settings {
  fontScale: number; // 0..4
  hue: number; // 0..359, la couleur globale « arc-en-ciel néon »
  volume: number; // 0..5
  lang: Lang;
  zoom: ZoomLevels; // 0..4 par écran
  showHidden: boolean;
  /** « day » groupe par journée ; « compact » enchaîne les journées en largeur. */
  layout: 'day' | 'compact';
  /** Ordre de la grille d'albums. « year » lit l'année écrite dans le nom. */
  albumSort: AlbumSort;
  /** Si vrai, seul un admin déverrouillé peut envoyer des photos. */
  uploadRequiresAdmin: boolean;
}

export interface Root {
  id: number;
  path: string;
  /** « import » reçoit les envois et sert de boîte de dépôt ; il est aussi scanné. */
  kind: 'photos' | 'music' | 'ui' | 'import';
  exists: boolean;
}

export interface UploadResult {
  name: string;
  outcome: 'stored' | 'duplicate' | 'rejected';
}

export interface ScanStatus {
  running: boolean;
  phase: 'idle' | 'walking' | 'indexing' | 'thumbnails' | 'done';
  found: number;
  indexed: number;
  thumbsDone: number;
  thumbsTotal: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}

export interface AppState {
  settings: Settings;
  albums: Album[];
  tags: string[];
  /**
   * Teinte choisie pour un tag, 0-359. Un tag absent de la table n'a pas de
   * couleur et garde l'apparence neutre.
   */
  tagColors: Record<string, number>;
  places: string[];
  roots: Root[];
  isAdmin: boolean;
  /**
   * Mode enfant : l'application est bridée. Hors de ce mode elle est ouverte,
   * ce qui est le réglage par défaut.
   */
  childMode: boolean;
  adminPasswordSet: boolean;
  scan: ScanStatus;
  counts: { photos: number; videos: number; hidden: number };
  musicSlots: number[];
  /** Noms des images utilisables comme arrière-plan d'album. */
  backgrounds: string[];
  bounds: { min: number | null; max: number | null };
}

export interface MediaQuery {
  from?: number; // epoch ms inclusif
  to?: number; // epoch ms inclusif
  tags?: string[];
  place?: string;
  album?: number;
  kind?: MediaKind;
  /**
   * Inclure les photos cachées. Passé explicitement plutôt que lu du réglage
   * côté serveur : c'est ce qui fait que basculer « voir les photos cachées »
   * change la requête, donc recharge la liste tout de suite.
   */
  showHidden?: boolean;
  cursor?: string;
  limit?: number;
}

export interface MediaPage {
  items: MediaItem[];
  /** Curseur opaque « takenAt.id » à repasser tel quel pour la page suivante. */
  nextCursor: string | null;
  total: number;
}

export interface HistogramBucket {
  month: number; // epoch ms du 1er du mois
  count: number;
}

/**
 * Comment lire une vidéo donnée. Les téléphones filment souvent en HEVC/H.265,
 * que les navigateurs ne décodent pas : le serveur en prépare alors une copie
 * H.264, sans jamais toucher au fichier d'origine.
 */
export interface PlaybackInfo {
  /** Le fichier d'origine passe tel quel dans le navigateur. */
  direct: boolean;
  state: 'ready' | 'working' | 'error';
  /** Avancement de la conversion, de 0 à 1. */
  progress: number;
  /** URL à donner à la balise vidéo, une fois prête. */
  url: string | null;
  vcodec: string | null;
}
