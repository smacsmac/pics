import type { Lang } from '../../../shared/types';

export const LANGS: Array<{ code: Lang; flag: string; label: string }> = [
  { code: 'en', flag: '🇬🇧', label: 'English' },
  { code: 'fr', flag: '⚜️', label: 'Français' },
  { code: 'ko', flag: '🇰🇷', label: '한국어' },
];

/** Locales complètes pour Intl : dates et nombres suivent la langue choisie. */
export const LOCALE: Record<Lang, string> = {
  en: 'en-CA',
  fr: 'fr-CA',
  ko: 'ko-KR',
};

const en = {
  search: 'Search',
  albums: 'Albums',
  favorites: 'Favorites',
  videos: 'Videos',
  newAlbum: 'New album',
  settings: 'Settings',
  recent: 'Recent',

  from: 'from',
  to: 'to',
  place: 'place',
  tags: 'tags',
  tbd: 'TBD',
  anyPlace: 'anywhere',
  anyTag: 'any tag',
  clearFilters: 'Clear filters',
  filtered: 'filtered',

  fontSize: 'Font size',
  volume: 'Volume',
  theme: 'Theme',
  admin: 'Admin',
  folders: 'Folders',
  language: 'Language',
  showHidden: 'Show hidden',

  name: 'name',
  color: 'colour',
  music: 'music',
  create: 'Create',
  save: 'Save',
  cancel: 'Cancel',
  deleteAlbum: 'Delete album',
  editAlbum: 'Edit album',
  cover: 'Cover',
  setCover: 'Set as cover',
  noMusic: 'none',
  confirmDeleteAlbum: 'Delete this album? The photos stay in your library.',

  addToAlbum: 'Add to album',
  removeFromAlbum: 'Remove from album',
  hide: 'Hide',
  unhide: 'Unhide',
  hidden: 'Hidden',
  fullscreen: 'Full screen',
  openMenu: 'More',
  editTags: 'Edit tags',
  addTag: 'add a tag…',
  selectMode: 'Select',
  selected: (n: number) => `${n} selected`,
  selectAll: 'Select all',
  clearSelection: 'Clear selection',

  password: 'password',
  unlock: 'Unlock',
  lock: 'Lock',
  setPassword: 'Choose an admin password',
  changePassword: 'Change password',
  wrongPassword: 'Wrong password',
  passwordTooShort: 'At least 4 characters',
  adminOnly: 'Admin only',
  adminUnlocked: 'Admin unlocked',

  photoFolders: 'Photo folders',
  musicFolder: 'Music folder',
  uiFolder: 'Interface images',
  addFolder: 'Add a folder…',
  folderPath: 'Full path, e.g. C:\\Users\\me\\Pictures',
  add: 'Add',
  remove: 'Remove',
  rescan: 'Rescan now',
  fixPlaces: 'Recompute places',
  missing: 'not found',

  scanning: 'Scanning',
  indexing: 'Indexing',
  thumbnails: 'Thumbnails',
  scanDone: 'Library up to date',
  noPhotosTitle: 'No photos yet',
  noPhotosBody: 'Open Settings → Folders and point Photon at a folder of photos.',
  noResults: 'Nothing matches these filters',
  emptyAlbum: 'This album is empty',
  loading: 'Loading…',
  photos: 'photos',
  videosLower: 'videos',
  photoCount: (n: number) => `${n} photo${n === 1 ? '' : 's'}`,
  videoCount: (n: number) => `${n} video${n === 1 ? '' : 's'}`,
  play: 'Press A to play',
  musicBlocked: 'Click once on the page to allow sound',
  musicNoFolder: 'No music folder yet — Settings → Folders',
  musicHint: 'Name the files 1.mp3 … 5.mp3, then pick a track in each album (Edit album → music).',

  controls: 'Controls',
  today: 'Today',
  unknownDate: 'Undated',
};

type Dict = typeof en;

const fr: Dict = {
  search: 'Chercher',
  albums: 'Albums',
  favorites: 'Favoris',
  videos: 'Vidéos',
  newAlbum: 'Nouvel album',
  settings: 'Paramètres',
  recent: 'Récents',

  from: 'de',
  to: 'à',
  place: 'endroit',
  tags: 'tags',
  tbd: 'TBD',
  anyPlace: 'partout',
  anyTag: 'tous',
  clearFilters: 'Effacer les filtres',
  filtered: 'filtré',

  fontSize: 'Taille du texte',
  volume: 'Volume',
  theme: 'Thème',
  admin: 'Admin',
  folders: 'Dossiers',
  language: 'Langue',
  showHidden: 'Voir les photos cachées',

  name: 'nom',
  color: 'couleur',
  music: 'musique',
  create: 'Créer',
  save: 'Enregistrer',
  cancel: 'Annuler',
  deleteAlbum: "Supprimer l'album",
  editAlbum: "Modifier l'album",
  cover: 'Couverture',
  setCover: 'Définir comme couverture',
  noMusic: 'aucune',
  confirmDeleteAlbum: 'Supprimer cet album ? Les photos restent dans la bibliothèque.',

  addToAlbum: 'Ajouter à un album',
  removeFromAlbum: 'Retirer de cet album',
  hide: 'Cacher',
  unhide: 'Ne plus cacher',
  hidden: 'Cachée',
  fullscreen: 'Plein écran',
  openMenu: 'Plus',
  editTags: 'Modifier les tags',
  addTag: 'ajouter un tag…',
  selectMode: 'Sélection',
  selected: (n: number) => `${n} sélectionnée${n > 1 ? 's' : ''}`,
  selectAll: 'Tout sélectionner',
  clearSelection: 'Tout désélectionner',

  password: 'mot de passe',
  unlock: 'Déverrouiller',
  lock: 'Verrouiller',
  setPassword: 'Choisissez un mot de passe admin',
  changePassword: 'Changer le mot de passe',
  wrongPassword: 'Mauvais mot de passe',
  passwordTooShort: 'Au moins 4 caractères',
  adminOnly: 'Réservé à l’admin',
  adminUnlocked: 'Mode admin activé',

  photoFolders: 'Dossiers de photos',
  musicFolder: 'Dossier de musique',
  uiFolder: 'Images d’interface',
  addFolder: 'Ajouter un dossier…',
  folderPath: 'Chemin complet, ex. C:\\Users\\moi\\Images',
  add: 'Ajouter',
  remove: 'Retirer',
  rescan: 'Relancer le scan',
  fixPlaces: 'Recalculer les lieux',
  missing: 'introuvable',

  scanning: 'Scan en cours',
  indexing: 'Indexation',
  thumbnails: 'Vignettes',
  scanDone: 'Bibliothèque à jour',
  noPhotosTitle: 'Aucune photo pour l’instant',
  noPhotosBody: 'Ouvrez Paramètres → Dossiers et indiquez un dossier de photos.',
  noResults: 'Rien ne correspond à ces filtres',
  emptyAlbum: 'Cet album est vide',
  loading: 'Chargement…',
  photos: 'photos',
  videosLower: 'vidéos',
  photoCount: (n: number) => `${n} photo${n > 1 ? 's' : ''}`,
  videoCount: (n: number) => `${n} vidéo${n > 1 ? 's' : ''}`,
  play: 'Appuyez sur A pour lire',
  musicBlocked: 'Cliquez une fois dans la page pour autoriser le son',
  musicNoFolder: 'Aucun dossier de musique — Paramètres → Dossiers',
  musicHint: 'Nommez les fichiers 1.mp3 … 5.mp3, puis choisissez la piste dans chaque album (Modifier l’album → musique).',

  controls: 'Contrôles',
  today: 'Aujourd’hui',
  unknownDate: 'Sans date',
};

const ko: Dict = {
  search: '검색',
  albums: '앨범',
  favorites: '즐겨찾기',
  videos: '동영상',
  newAlbum: '새 앨범',
  settings: '설정',
  recent: '최근',

  from: '부터',
  to: '까지',
  place: '장소',
  tags: '태그',
  tbd: '미정',
  anyPlace: '전체',
  anyTag: '전체',
  clearFilters: '필터 지우기',
  filtered: '필터됨',

  fontSize: '글자 크기',
  volume: '음량',
  theme: '테마',
  admin: '관리자',
  folders: '폴더',
  language: '언어',
  showHidden: '숨긴 사진 보기',

  name: '이름',
  color: '색상',
  music: '음악',
  create: '만들기',
  save: '저장',
  cancel: '취소',
  deleteAlbum: '앨범 삭제',
  editAlbum: '앨범 편집',
  cover: '커버',
  setCover: '커버로 지정',
  noMusic: '없음',
  confirmDeleteAlbum: '이 앨범을 삭제할까요? 사진은 그대로 남습니다.',

  addToAlbum: '앨범에 추가',
  removeFromAlbum: '앨범에서 제거',
  hide: '숨기기',
  unhide: '숨김 해제',
  hidden: '숨김',
  fullscreen: '전체 화면',
  openMenu: '더보기',
  editTags: '태그 편집',
  addTag: '태그 추가…',
  selectMode: '선택',
  selected: (n: number) => `${n}개 선택됨`,
  selectAll: '모두 선택',
  clearSelection: '선택 해제',

  password: '비밀번호',
  unlock: '잠금 해제',
  lock: '잠금',
  setPassword: '관리자 비밀번호를 정하세요',
  changePassword: '비밀번호 변경',
  wrongPassword: '비밀번호가 틀렸습니다',
  passwordTooShort: '4자 이상',
  adminOnly: '관리자 전용',
  adminUnlocked: '관리자 모드',

  photoFolders: '사진 폴더',
  musicFolder: '음악 폴더',
  uiFolder: '인터페이스 이미지',
  addFolder: '폴더 추가…',
  folderPath: '전체 경로, 예: C:\\Users\\me\\Pictures',
  add: '추가',
  remove: '제거',
  rescan: '다시 검색',
  fixPlaces: '장소 다시 계산',
  missing: '없음',

  scanning: '검색 중',
  indexing: '색인 중',
  thumbnails: '썸네일',
  scanDone: '최신 상태',
  noPhotosTitle: '아직 사진이 없습니다',
  noPhotosBody: '설정 → 폴더에서 사진 폴더를 지정하세요.',
  noResults: '조건에 맞는 항목이 없습니다',
  emptyAlbum: '빈 앨범입니다',
  loading: '불러오는 중…',
  photos: '사진',
  videosLower: '동영상',
  photoCount: (n: number) => `사진 ${n}장`,
  videoCount: (n: number) => `동영상 ${n}개`,
  play: 'A를 눌러 재생',
  musicBlocked: '소리를 허용하려면 페이지를 한 번 클릭하세요',
  musicNoFolder: '음악 폴더가 없습니다 — 설정 → 폴더',
  musicHint: '파일을 1.mp3 … 5.mp3 로 두고, 앨범마다 트랙을 고르세요 (앨범 편집 → 음악).',

  controls: '조작',
  today: '오늘',
  unknownDate: '날짜 없음',
};

const DICTS: Record<Lang, Dict> = { en, fr, ko };

export function dict(lang: Lang): Dict {
  return DICTS[lang] ?? en;
}

export function monthNames(lang: Lang, style: 'short' | 'long' = 'short'): string[] {
  const fmt = new Intl.DateTimeFormat(LOCALE[lang], { month: style });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2024, i, 1)));
}

export function formatDayHeading(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(ts));
}

export function formatMonthLabel(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], { month: 'short', year: 'numeric' }).format(
    new Date(ts),
  );
}

export function formatDateTime(ts: number, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(ts));
}
