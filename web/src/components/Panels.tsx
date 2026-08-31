import type { Lang } from '../../../shared/types';
import { LANGS, monthNames } from '../lib/i18n';
import {
  FONT_BOXES, FONT_MAX, HUES, SCREENSAVER_MINUTES, SLIDE_SECONDS, VOLUME_BOXES, VOLUME_MAX,
  rightRows,
} from '../lib/panels';
import { useStore, type MonthValue } from '../lib/store';
import {
  IconChild, IconEye, IconFolder, IconFont, IconGlobe, IconPalette, IconSlideshow, IconVolume,
} from './Icons';

/** Valeur affichée dans [mois] [année] : le filtre s'il existe, sinon la borne. */
export function displayMonth(value: MonthValue | null, fallbackTs: number | null): MonthValue {
  if (value) return value;
  const d = fallbackTs !== null ? new Date(fallbackTs) : new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

interface PanelProps {
  /** Remonte le focus clavier/manette là où la souris vient de cliquer. */
  onFocusRow: (row: number, sub?: number) => void;
}

export function SearchPanel({ onFocusRow }: PanelProps): React.JSX.Element {
  const { nav, filters, setFilters, clearFilters, settings, state, t, tagCursor, setSheet, view, setOsk } =
    useStore();
  const active = nav.zone === 'left';
  const rowAt = (i: number): boolean => active && nav.panelIndex === i;
  const months = monthNames(settings.lang);
  const bounds = state?.bounds ?? { min: null, max: null };
  // Sur l'écran Albums on cherche des albums, pas des photos : ni dates ni lieu.
  const albumsView = view.kind === 'albums';

  const from = displayMonth(filters.from, bounds.min);
  const to = displayMonth(filters.to, bounds.max);
  const tags = state?.tags ?? [];
  const places = state?.places ?? [];
  const hoveredTag = tags.length > 0 ? tags[((tagCursor % tags.length) + tags.length) % tags.length] : null;
  // Le tag sous le curseur n'est qu'un *candidat* : c'est A (ou un clic) qui
  // l'applique. Il s'affichait comme un filtre posé, ce qui donnait
  // l'impression d'avoir filtré alors que toutes les photos restaient là.
  const hoveredApplied = hoveredTag !== null && filters.tags.includes(hoveredTag);

  /** Bloc de tags, partagé par les deux versions du panneau. */
  const tagsRow = (index: number): React.JSX.Element => (
    <div className={`panel-row${rowAt(index) ? ' on' : ''}`} onMouseEnter={() => onFocusRow(index)}>
      <span className="lab">{albumsView ? t.albumTags : t.tags}</span>
      <div className="row-line">
        <button
          className={`pill${rowAt(index) ? ' on' : ''}${hoveredApplied ? '' : ' muted'}`}
          onClick={() => {
            onFocusRow(index);
            setSheet({ kind: 'tagPicker' });
          }}
        >
          {hoveredTag === null ? t.anyTag : hoveredApplied ? hoveredTag : `+ ${hoveredTag}`}
        </button>
      </div>
      {filters.tags.length > 0 && (
        <div className="chip-row">
          {filters.tags.map((tag) => {
            const hue = state?.tagColors[tag];
            return (
              <button
                key={tag}
                // Un tag coloré garde sa couleur ici aussi : on retrouve le
                // même repère visuel du filtre jusqu'aux photos.
                className={`chip on${hue === undefined ? '' : ' tag tinted'}`}
                style={hue === undefined ? undefined : ({ ['--tag-hue' as string]: String(hue) })}
                title={t.remove}
                onClick={() => setFilters((f) => ({ ...f, tags: f.tags.filter((x) => x !== tag) }))}
              >
                {tag}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  if (albumsView) {
    return (
      <aside className="panel">
        <div className={`panel-row${rowAt(0) ? ' on' : ''}`} onMouseEnter={() => onFocusRow(0)}>
          <span className="lab">{t.albumName}</span>
          <div className="row-line">
            <input
              className="text-input"
              value={filters.text}
              placeholder={t.anyAlbum}
              onChange={(e) => setFilters((f) => ({ ...f, text: e.target.value }))}
              onFocus={() => onFocusRow(0)}
            />
          </div>
          {/* Sans clavier physique, A ouvre le clavier à l'écran. */}
          <button
            className="mini-btn"
            onClick={() =>
              setOsk({
                label: t.albumName,
                value: filters.text,
                onCommit: (value) => setFilters((f) => ({ ...f, text: value })),
              })
            }
          >
            {t.type}
          </button>
        </div>

        {tagsRow(1)}

        <button
          className={`panel-row${rowAt(2) ? ' on' : ''}`}
          style={{ textAlign: 'left' }}
          onMouseEnter={() => onFocusRow(2)}
          onClick={clearFilters}
        >
          <span className="lab">{t.clearFilters}</span>
        </button>
      </aside>
    );
  }

  const openMonth = (which: 'from' | 'to', field: 'month' | 'year', sub: number): void => {
    onFocusRow(which === 'from' ? 0 : 1, sub);
    setSheet({ kind: 'monthPicker', which, field });
  };

  const dateRow = (
    index: number,
    which: 'from' | 'to',
    label: string,
    value: MonthValue,
    isSet: boolean,
  ): React.JSX.Element => (
    <div className={`panel-row${rowAt(index) ? ' on' : ''}`} onMouseEnter={() => onFocusRow(index)}>
      <span className="lab">{label}</span>
      <div className="row-line">
        <button
          className={`pill${rowAt(index) && nav.subIndex === 0 ? ' on' : ''}${isSet ? '' : ' muted'}`}
          onClick={() => openMonth(which, 'month', 0)}
        >
          {months[value.month]}
        </button>
        <button
          className={`pill dark${rowAt(index) && nav.subIndex === 1 ? ' on' : ''}${isSet ? '' : ' muted'}`}
          onClick={() => openMonth(which, 'year', 1)}
        >
          {value.year}
        </button>
      </div>
    </div>
  );

  return (
    <aside className="panel">
      {dateRow(0, 'from', t.from, from, filters.from !== null)}
      {dateRow(1, 'to', t.to, to, filters.to !== null)}

      <div className={`panel-row${rowAt(2) ? ' on' : ''}`} onMouseEnter={() => onFocusRow(2)}>
        <span className="lab">{t.place}</span>
        <div className="row-line">
          <button
            className={`pill${rowAt(2) ? ' on' : ''}${filters.place ? '' : ' muted'}`}
            onClick={() => {
              onFocusRow(2);
              setSheet({ kind: 'placePicker' });
            }}
          >
            {filters.place ?? t.anyPlace}
          </button>
        </div>
        {places.length === 0 && <span className="mini">—</span>}
      </div>

      {tagsRow(3)}

      <div className={`panel-row${rowAt(4) ? ' on' : ''}`} onMouseEnter={() => onFocusRow(4)}>
        <span className="lab">{t.tbd}</span>
        <span className="mini">—</span>
      </div>

      <button
        className={`panel-row${rowAt(5) ? ' on' : ''}`}
        style={{ textAlign: 'left' }}
        onMouseEnter={() => onFocusRow(5)}
        onClick={clearFilters}
      >
        <span className="lab">{t.clearFilters}</span>
      </button>
    </aside>
  );
}

export function SettingsPanel({ onFocusRow }: PanelProps): React.JSX.Element {
  const { nav, settings, patchSettings, state, t, setSheet } = useStore();
  const active = nav.zone === 'right';
  const isAdmin = state?.isAdmin ?? false;
  const rows = rightRows(isAdmin);
  const indexOf = (id: string): number => rows.findIndex((r) => r.id === id);
  const rowAt = (id: string): boolean => active && rows[nav.panelIndex]?.id === id;

  /** `filled` compte les cases allumées, pas un index : 0 en allume aucune. */
  const steps = (
    boxes: number,
    filled: number,
    onPick: (box: number) => void,
  ): React.JSX.Element => (
    <div className="steps">
      {Array.from({ length: boxes }, (_, i) => (
        <button
          key={i}
          className={`step${i < filled ? ' filled' : ''}`}
          onClick={() => onPick(i)}
          aria-label={String(i + 1)}
        />
      ))}
    </div>
  );

  /**
   * Un réglage du diaporama : son nom à gauche, sa valeur à droite. Le tout est
   * un bouton, donc un clic avance la valeur — comme A à la manette.
   */
  const slideField = (
    sub: number,
    label: string,
    value: string,
    active: boolean,
    onNext: () => void,
  ): React.JSX.Element => (
    <button
      className={`slide-field${active ? ' on' : ''}${
        rowAt('slideshow') && nav.subIndex === sub ? ' aim' : ''
      }`}
      onClick={() => {
        onFocusRow(indexOf('slideshow'), sub);
        onNext();
      }}
    >
      <span className="k">{label}</span>
      <span className="v">{value}</span>
    </button>
  );

  const photoRoots = (state?.roots ?? []).filter((r) => r.kind === 'photos');

  return (
    <aside className="panel right">
      <div className={`panel-row${rowAt('font') ? ' on' : ''}`} onMouseEnter={() => onFocusRow(indexOf('font'))}>
        <div className="row-line">
          <IconFont />
          <span className="lab">{t.fontSize}</span>
        </div>
        {steps(FONT_BOXES, settings.fontScale + 1, (box) =>
          patchSettings({ fontScale: Math.min(FONT_MAX, box) }),
        )}
      </div>

      <div className={`panel-row${rowAt('volume') ? ' on' : ''}`} onMouseEnter={() => onFocusRow(indexOf('volume'))}>
        <div className="row-line">
          <IconVolume />
          <span className="lab">{t.volume}</span>
        </div>
        {/* Recliquer la seule case allumée coupe le son : sans ça, 0 serait
            inatteignable à la souris. */}
        {steps(VOLUME_BOXES, settings.volume, (box) =>
          patchSettings({
            volume: settings.volume === box + 1 && box === 0 ? 0 : Math.min(VOLUME_MAX, box + 1),
          }),
        )}
      </div>

      <div className={`panel-row${rowAt('theme') ? ' on' : ''}`} onMouseEnter={() => onFocusRow(indexOf('theme'))}>
        <div className="row-line">
          <IconPalette />
          <span className="lab">{t.theme}</span>
        </div>
        <div className="hues">
          {HUES.map((hue) => (
            <button
              key={hue}
              className={`hue-chip${settings.hue === hue ? ' on' : ''}`}
              style={{ background: `hsl(${hue} 88% 58%)`, color: `hsl(${hue} 100% 62%)` }}
              onClick={() => patchSettings({ hue })}
              aria-label={`${t.theme} ${hue}`}
            />
          ))}
        </div>
      </div>

      {/* Réglages du diaporama. Chaque champ occupe sa propre ligne, libellé à
          gauche et valeur à droite : sur une barre de 208 px, deux réglages
          côte à côte tronquaient leur nom (« mouve… »). ←/→ passent d'un champ
          à l'autre à la manette, LB/RB en changent la valeur, A l'avance. */}
      <div
        className={`panel-row${rowAt('slideshow') ? ' on' : ''}`}
        onMouseEnter={() => onFocusRow(indexOf('slideshow'))}
      >
        <div className="row-line">
          <IconSlideshow />
          <span className="lab">{t.slideshow}</span>
        </div>

        <div className="slide-settings">
          {slideField(0, t.slideshowSpeed, `${settings.slideshowSeconds} s`, false, () => {
            const i = SLIDE_SECONDS.indexOf(settings.slideshowSeconds);
            patchSettings({ slideshowSeconds: SLIDE_SECONDS[(i + 1) % SLIDE_SECONDS.length] });
          })}

          {slideField(
            1,
            t.slideshowShuffle,
            settings.slideshowShuffle ? t.slideshowOn : t.slideshowOff,
            settings.slideshowShuffle,
            () => patchSettings({ slideshowShuffle: !settings.slideshowShuffle }),
          )}

          {slideField(
            2,
            t.slideshowPan,
            settings.slideshowPan ? t.slideshowOn : t.slideshowOff,
            settings.slideshowPan,
            () => patchSettings({ slideshowPan: !settings.slideshowPan }),
          )}

          {slideField(
            3,
            t.screensaver,
            settings.screensaverMinutes > 0
              ? t.minutesShort(settings.screensaverMinutes)
              : t.screensaverOff,
            settings.screensaverMinutes > 0,
            () => {
              const i = SCREENSAVER_MINUTES.indexOf(settings.screensaverMinutes);
              patchSettings({
                screensaverMinutes: SCREENSAVER_MINUTES[(i + 1) % SCREENSAVER_MINUTES.length],
              });
            },
          )}
        </div>
      </div>

      {/* Mode enfant : l'application est ouverte par défaut, et on la bride
          d'un geste avant de la confier aux enfants. En sortir demande le mot
          de passe — sinon le mode ne protégerait rien. */}
      <button
        className={`panel-row${rowAt('admin') ? ' on' : ''}`}
        style={{ textAlign: 'left' }}
        onMouseEnter={() => onFocusRow(indexOf('admin'))}
        onClick={() => setSheet({ kind: 'admin' })}
      >
        <div className="row-line">
          <IconChild />
          <span className="lab">{t.childMode}</span>
          <span className={`toggle${state?.childMode ? ' on' : ''}`}>
            <span className="knob" />
          </span>
        </div>
        <span className="mini">
          {state?.childMode
            ? isAdmin ? t.childModeOnUnlocked : t.childModeOn
            : t.childModeOff}
        </span>
      </button>

      {isAdmin && (
        <button
          className={`panel-row${rowAt('folders') ? ' on' : ''}`}
          style={{ textAlign: 'left' }}
          onMouseEnter={() => onFocusRow(indexOf('folders'))}
          onClick={() => setSheet({ kind: 'folders' })}
        >
          <div className="row-line">
            <IconFolder />
            <span className="lab">{t.folders}</span>
          </div>
          <span className="mini">
            {photoRoots.length > 0
              ? `${photoRoots.length} · ${state?.counts.photos ?? 0} ${t.photos}`
              : t.addFolder}
          </span>
        </button>
      )}

      <div className={`panel-row${rowAt('lang') ? ' on' : ''}`} onMouseEnter={() => onFocusRow(indexOf('lang'))}>
        <div className="row-line">
          <IconGlobe />
          <span className="lab">{t.language}</span>
        </div>
        {/* Un seul long bouton segmenté, séparé par des barres obliques : EN / FR / KR. */}
        <div className="lang-pill">
          {LANGS.map((lang, i) => (
            <span key={lang.code} className="seg">
              {i > 0 && <span className="slash">/</span>}
              <button
                className={`code${settings.lang === lang.code ? ' on' : ''}${
                  rowAt('lang') && nav.subIndex === i ? ' aim' : ''
                }`}
                title={lang.label}
                onClick={() => {
                  onFocusRow(indexOf('lang'), i);
                  patchSettings({ lang: lang.code as Lang });
                }}
              >
                {lang.short}
              </button>
            </span>
          ))}
        </div>
      </div>

      {isAdmin && (
        <button
          className={`panel-row${rowAt('hidden') ? ' on' : ''}`}
          style={{ textAlign: 'left' }}
          onMouseEnter={() => onFocusRow(indexOf('hidden'))}
          onClick={() => patchSettings({ showHidden: !settings.showHidden })}
        >
          <div className="row-line">
            <IconEye />
            <span className="lab">{t.showHidden}</span>
          </div>
          <span className="mini">
            {settings.showHidden ? '● ' : '○ '}
            {state?.counts.hidden ?? 0}
          </span>
        </button>
      )}
    </aside>
  );
}
