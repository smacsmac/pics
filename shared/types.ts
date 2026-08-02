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
  tags: string[];
}

export interface Album {
  id: number;
  name: string;
  color: number; // teinte 0-359
  musicSlot: number | null; // 1..5
  coverMediaId: number | null;
  kind: 'user' | 'favorites';
  count: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  fontScale: number; // 0..4
  hue: number; // 0..359, la couleur globale « arc-en-ciel néon »
  volume: number; // 0..5
  lang: Lang;
  thumbSize: number; // 0..4
  showHidden: boolean;
}

export interface Root {
  id: number;
  path: string;
  kind: 'photos' | 'music' | 'ui';
  exists: boolean;
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
  places: string[];
  roots: Root[];
  isAdmin: boolean;
  adminPasswordSet: boolean;
  scan: ScanStatus;
  counts: { photos: number; videos: number; hidden: number };
  musicSlots: number[];
  bounds: { min: number | null; max: number | null };
}

export interface MediaQuery {
  from?: number; // epoch ms inclusif
  to?: number; // epoch ms inclusif
  tags?: string[];
  place?: string;
  album?: number;
  kind?: MediaKind;
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
