import type { Lang } from '../../../shared/types';
import { LANGS, monthNames } from '../lib/i18n';
import { FONT_BOXES, FONT_MAX, HUES, VOLUME_BOXES, VOLUME_MAX, rightRows } from '../lib/panels';
import { useStore, type MonthValue } from '../lib/store';
import { IconEye, IconFolder, IconFont, IconGlobe, IconKey, IconPalette, IconVolume } from './Icons';

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
  const { nav, filters, setFilters, clearFilters, settings, state, t, tagCursor, setSheet } = useStore();
  const active = nav.zone === 'left';
  const rowAt = (i: number): boolean => active && nav.panelIndex === i;
  const months = monthNames(settings.lang);
  const bounds = state?.bounds ?? { min: null, max: null };

  const from = displayMonth(filters.from, bounds.min);
  const to = displayMonth(filters.to, bounds.max);
  const tags = state?.tags ?? [];
  const places = state?.places ?? [];
  const hoveredTag = tags.length > 0 ? tags[((tagCursor % tags.length) + tags.length) % tags.length] : null;

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

      <div className={`panel-row${rowAt(3) ? ' on' : ''}`} onMouseEnter={() => onFocusRow(3)}>
        <span className="lab">{t.tags}</span>
        <div className="row-line">
          <button
            className={`pill${rowAt(3) ? ' on' : ''}${hoveredTag ? '' : ' muted'}`}
            onClick={() => {
              onFocusRow(3);
              setSheet({ kind: 'tagPicker' });
            }}
          >
            {hoveredTag ?? t.anyTag}
          </button>
        </div>
        {filters.tags.length > 0 && (
          <div className="chip-row">
            {filters.tags.map((tag) => (
              <button
                key={tag}
                className="chip on"
                title={t.remove}
                onClick={() => setFilters((f) => ({ ...f, tags: f.tags.filter((x) => x !== tag) }))}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

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

      <button
        className={`panel-row${rowAt('admin') ? ' on' : ''}`}
        style={{ textAlign: 'left' }}
        onMouseEnter={() => onFocusRow(indexOf('admin'))}
        onClick={() => setSheet({ kind: 'admin' })}
      >
        <div className="row-line">
          <IconKey />
          <span className="lab">{t.admin}</span>
        </div>
        <span className="mini">
          {isAdmin ? t.adminUnlocked : state?.adminPasswordSet ? t.password : t.setPassword}
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
        <div className="flags">
          {LANGS.map((lang, i) => (
            <button
              key={lang.code}
              className={`flag${settings.lang === lang.code ? ' on' : ''}`}
              title={lang.label}
              style={
                rowAt('lang') && nav.subIndex === i
                  ? { outline: '1px solid var(--accent)', outlineOffset: '1px' }
                  : undefined
              }
              onClick={() => {
                onFocusRow(indexOf('lang'), i);
                patchSettings({ lang: lang.code as Lang });
              }}
            >
              {lang.flag}
            </button>
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
