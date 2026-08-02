import type { MonthValue } from '../lib/store';
import { LANGS, monthNames } from '../lib/i18n';
import { FONT_BOXES, HUES, LEFT_ROWS, VOLUME_BOXES, rightRows } from '../lib/panels';
import { useStore } from '../lib/store';
import { IconEye, IconFolder, IconFont, IconGlobe, IconKey, IconPalette, IconVolume } from './Icons';

/** Valeur affichée dans [mois] [année] : le filtre s'il existe, sinon la borne. */
export function displayMonth(value: MonthValue | null, fallbackTs: number | null): MonthValue {
  if (value) return value;
  const d = fallbackTs !== null ? new Date(fallbackTs) : new Date();
  return { year: d.getFullYear(), month: d.getMonth() };
}

export function SearchPanel(): React.JSX.Element {
  const { nav, filters, settings, state, t, tagCursor } = useStore();
  const active = nav.zone === 'left';
  const rowAt = (i: number): boolean => active && nav.panelIndex === i;
  const months = monthNames(settings.lang);
  const bounds = state?.bounds ?? { min: null, max: null };

  const from = displayMonth(filters.from, bounds.min);
  const to = displayMonth(filters.to, bounds.max);
  const tags = state?.tags ?? [];
  const places = state?.places ?? [];
  const hoveredTag = tags.length > 0 ? tags[((tagCursor % tags.length) + tags.length) % tags.length] : null;

  const dateRow = (
    index: number,
    label: string,
    value: MonthValue,
    isSet: boolean,
  ): React.JSX.Element => (
    <div className={`panel-row${rowAt(index) ? ' on' : ''}`}>
      <span className="lab">{label}</span>
      <div className="row-line">
        <span
          className={`pill${rowAt(index) && nav.subIndex === 0 ? ' on' : ''}${isSet ? '' : ' muted'}`}
        >
          {months[value.month]}
        </span>
        <span
          className={`pill dark${rowAt(index) && nav.subIndex === 1 ? ' on' : ''}${isSet ? '' : ' muted'}`}
        >
          {value.year}
        </span>
      </div>
    </div>
  );

  return (
    <aside className="panel">
      {dateRow(0, t.from, from, filters.from !== null)}
      {dateRow(1, t.to, to, filters.to !== null)}

      <div className={`panel-row${rowAt(2) ? ' on' : ''}`}>
        <span className="lab">{t.place}</span>
        <div className="row-line">
          <span className={`pill${rowAt(2) ? ' on' : ''}${filters.place ? '' : ' muted'}`}>
            {filters.place ?? t.anyPlace}
          </span>
        </div>
        {places.length === 0 && <span className="mini">—</span>}
      </div>

      <div className={`panel-row${rowAt(3) ? ' on' : ''}`}>
        <span className="lab">{t.tags}</span>
        <div className="row-line">
          <span className={`pill${rowAt(3) ? ' on' : ''}${hoveredTag ? '' : ' muted'}`}>
            {hoveredTag ?? t.anyTag}
          </span>
        </div>
        {filters.tags.length > 0 && (
          <div className="chip-row">
            {filters.tags.map((tag) => (
              <span key={tag} className="chip on">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={`panel-row${rowAt(4) ? ' on' : ''}`}>
        <span className="lab">{t.tbd}</span>
        <span className="mini">—</span>
      </div>

      <div className={`panel-row${rowAt(5) ? ' on' : ''}`}>
        <span className="lab">{t.clearFilters}</span>
      </div>
    </aside>
  );
}

export function SettingsPanel(): React.JSX.Element {
  const { nav, settings, state, t } = useStore();
  const active = nav.zone === 'right';
  const isAdmin = state?.isAdmin ?? false;
  const rows = rightRows(isAdmin);
  const rowAt = (id: string): boolean => active && rows[nav.panelIndex]?.id === id;

  /** `filled` compte les cases allumées, pas un index : 0 en allume aucune. */
  const steps = (boxes: number, filled: number): React.JSX.Element => (
    <div className="steps">
      {Array.from({ length: boxes }, (_, i) => (
        <span key={i} className={`step${i < filled ? ' filled' : ''}`} />
      ))}
    </div>
  );

  const photoRoots = (state?.roots ?? []).filter((r) => r.kind === 'photos');

  return (
    <aside className="panel right">
      <div className={`panel-row${rowAt('font') ? ' on' : ''}`}>
        <div className="row-line">
          <IconFont className="ic" />
          <span className="lab">{t.fontSize}</span>
        </div>
        {steps(FONT_BOXES, settings.fontScale + 1)}
      </div>

      <div className={`panel-row${rowAt('volume') ? ' on' : ''}`}>
        <div className="row-line">
          <IconVolume className="ic" />
          <span className="lab">{t.volume}</span>
        </div>
        {steps(VOLUME_BOXES, settings.volume)}
      </div>

      <div className={`panel-row${rowAt('theme') ? ' on' : ''}`}>
        <div className="row-line">
          <IconPalette className="ic" />
          <span className="lab">{t.theme}</span>
        </div>
        <div className="hues">
          {HUES.map((hue) => (
            <span
              key={hue}
              className={`hue-chip${settings.hue === hue ? ' on' : ''}`}
              style={{ background: `hsl(${hue} 88% 58%)`, color: `hsl(${hue} 100% 62%)` }}
            />
          ))}
        </div>
      </div>

      <div className={`panel-row${rowAt('admin') ? ' on' : ''}`}>
        <div className="row-line">
          <IconKey className="ic" />
          <span className="lab">{t.admin}</span>
        </div>
        <span className="mini">
          {isAdmin ? t.adminUnlocked : state?.adminPasswordSet ? t.password : t.setPassword}
        </span>
      </div>

      {isAdmin && (
        <div className={`panel-row${rowAt('folders') ? ' on' : ''}`}>
          <div className="row-line">
            <IconFolder className="ic" />
            <span className="lab">{t.folders}</span>
          </div>
          <span className="mini">
            {photoRoots.length > 0
              ? `${photoRoots.length} · ${state?.counts.photos ?? 0} ${t.photos}`
              : t.addFolder}
          </span>
        </div>
      )}

      <div className={`panel-row${rowAt('lang') ? ' on' : ''}`}>
        <div className="row-line">
          <IconGlobe className="ic" />
          <span className="lab">{t.language}</span>
        </div>
        <div className="flags">
          {LANGS.map((lang, i) => (
            <span
              key={lang.code}
              className={`flag${settings.lang === lang.code ? ' on' : ''}`}
              title={lang.label}
              style={
                rowAt('lang') && nav.subIndex === i
                  ? { outline: '1px solid var(--accent)', outlineOffset: '1px' }
                  : undefined
              }
            >
              {lang.flag}
            </span>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className={`panel-row${rowAt('hidden') ? ' on' : ''}`}>
          <div className="row-line">
            <IconEye className="ic" />
            <span className="lab">{t.showHidden}</span>
          </div>
          <span className="mini">
            {settings.showHidden ? '● ' : '○ '}
            {state?.counts.hidden ?? 0}
          </span>
        </div>
      )}
    </aside>
  );
}
