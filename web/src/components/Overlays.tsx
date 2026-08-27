import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AlbumSort, Root } from '../../../shared/types';
import { api, ApiError } from '../lib/api';
import { LANGS, monthNames } from '../lib/i18n';
import { useInput } from '../lib/input';
import { HUES } from '../lib/panels';
import { useStore } from '../lib/store';
import {
  IconCheck, IconExpand, IconHeart, IconHide, IconPalette, IconPencil, IconPin, IconPlus, IconRotate,
  IconSelect, IconTag, IconTrash, IconX,
} from './Icons';

/** Enferme le curseur d'une liste dans ses bornes, avec bouclage. */
function wrap(index: number, length: number): number {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

// ------------------------------------------------------------------ carrousels

export function MonthPickerSheet(): React.JSX.Element | null {
  const { sheet, setSheet, filters, setFilters, settings, state, t } = useStore();
  const [cursor, setCursor] = useState(0);

  const picker = sheet?.kind === 'monthPicker' ? sheet : null;
  const bounds = state?.bounds ?? { min: null, max: null };

  const options = useMemo<Array<{ value: number; label: string }>>(() => {
    if (!picker) return [];
    if (picker.field === 'month') {
      return monthNames(settings.lang, 'long').map((label, value) => ({ value, label }));
    }
    const minYear = new Date(bounds.min ?? Date.now()).getFullYear();
    const maxYear = new Date(bounds.max ?? Date.now()).getFullYear();
    const years: Array<{ value: number; label: string }> = [];
    for (let y = maxYear; y >= minYear; y--) years.push({ value: y, label: String(y) });
    return years;
  }, [picker, settings.lang, bounds.min, bounds.max]);

  const current = picker ? (picker.which === 'from' ? filters.from : filters.to) : null;

  useEffect(() => {
    if (!picker) return;
    const value = picker.field === 'month' ? current?.month : current?.year;
    const found = options.findIndex((o) => o.value === value);
    setCursor(found >= 0 ? found : 0);
  }, [picker, options, current]);

  const commit = useCallback(
    (index: number) => {
      if (!picker) return;
      const option = options[index];
      if (!option) return;
      const fallback = new Date(picker.which === 'from' ? bounds.min ?? Date.now() : bounds.max ?? Date.now());
      const base = current ?? { year: fallback.getFullYear(), month: fallback.getMonth() };
      const next = picker.field === 'month'
        ? { ...base, month: option.value }
        : { ...base, year: option.value };
      setFilters((f) => (picker.which === 'from' ? { ...f, from: next } : { ...f, to: next }));
      setSheet(null);
    },
    [picker, options, current, bounds.min, bounds.max, setFilters, setSheet],
  );

  useInput(
    useCallback(
      (action) => {
        if (!picker) return false;
        if (action === 'left' || action === 'dec') setCursor((c) => wrap(c - 1, options.length));
        else if (action === 'right' || action === 'inc') setCursor((c) => wrap(c + 1, options.length));
        else if (action === 'up') setCursor((c) => wrap(c - 5, options.length));
        else if (action === 'down') setCursor((c) => wrap(c + 5, options.length));
        else if (action === 'confirm') commit(cursor);
        else if (action === 'back') setSheet(null);
        return true;
      },
      [picker, options.length, cursor, commit, setSheet],
    ),
    picker !== null,
  );

  if (!picker) return null;

  return (
    <div className="overlay" onClick={() => setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          {picker.which === 'from' ? t.from : t.to} · {picker.field === 'month' ? t.search : ''}
        </div>
        <div className="chip-row">
          {options.map((option, i) => (
            <button
              key={option.value}
              className={`chip${i === cursor ? ' on' : ''}`}
              onClick={() => commit(i)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PlacePickerSheet(): React.JSX.Element | null {
  const { sheet, setSheet, filters, setFilters, t } = useStore();
  const [places, setPlaces] = useState<Array<{ city: string; label: string; count: number }>>([]);
  const [cursor, setCursor] = useState(0);
  const open = sheet?.kind === 'placePicker';

  useEffect(() => {
    if (!open) return;
    void api.places().then(setPlaces).catch(() => setPlaces([]));
  }, [open]);

  const options = useMemo(
    () => [{ city: '', label: t.anyPlace, count: 0 }, ...places],
    [places, t.anyPlace],
  );

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) return;
      setFilters((f) => ({ ...f, place: option.city === '' ? null : option.city }));
      setSheet(null);
    },
    [options, setFilters, setSheet],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'up' || action === 'dec') setCursor((c) => wrap(c - 1, options.length));
        else if (action === 'down' || action === 'inc') setCursor((c) => wrap(c + 1, options.length));
        else if (action === 'confirm') commit(cursor);
        else if (action === 'back') setSheet(null);
        return true;
      },
      [open, options.length, cursor, commit, setSheet],
    ),
    open,
  );

  if (!open) return null;

  return (
    <div className="overlay" onClick={() => setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t.place}</div>
        <div className="option-list">
          {options.map((option, i) => (
            <button
              key={option.city || 'any'}
              className={`option${i === cursor ? ' on' : ''}`}
              onClick={() => commit(i)}
            >
              <span className="n">{option.label}</span>
              {option.count > 0 && <span className="c">{option.count}</span>}
              {filters.place === option.city && <IconCheck />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TagPickerSheet(): React.JSX.Element | null {
  const { sheet, setSheet, filters, setFilters, state, t } = useStore();
  const [cursor, setCursor] = useState(0);
  const open = sheet?.kind === 'tagPicker';
  const tags = state?.tags ?? [];

  const toggle = useCallback(
    (tag: string) => {
      setFilters((f) => ({
        ...f,
        tags: f.tags.includes(tag) ? f.tags.filter((x) => x !== tag) : [...f.tags, tag],
      }));
    },
    [setFilters],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'up' || action === 'dec') setCursor((c) => wrap(c - 1, tags.length));
        else if (action === 'down' || action === 'inc') setCursor((c) => wrap(c + 1, tags.length));
        else if (action === 'confirm') {
          const tag = tags[cursor];
          if (tag) toggle(tag);
        } else if (action === 'back') setSheet(null);
        return true;
      },
      [open, tags, cursor, toggle, setSheet],
    ),
    open,
  );

  if (!open) return null;

  return (
    <div className="overlay" onClick={() => setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t.tags}</div>
        {tags.length === 0 ? (
          <div className="mini">—</div>
        ) : (
          <div className="option-list">
            {tags.map((tag, i) => (
              <button
                key={tag}
                className={`option${i === cursor ? ' on' : ''}`}
                onClick={() => toggle(tag)}
              >
                {/* Pastille à la couleur du tag, pour le repérer dans la liste. */}
                <span
                  className="swatch"
                  style={{
                    background:
                      state?.tagColors[tag] === undefined
                        ? 'var(--surface-3)'
                        : `hsl(${state.tagColors[tag]} 72% 50%)`,
                  }}
                />
                <span className="n">{tag}</span>
                {filters.tags.includes(tag) && <IconCheck />}
              </button>
            ))}
          </div>
        )}
        <div className="form-actions">
          <button className="btn" onClick={() => setSheet(null)}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ admin

export function AdminSheet(): React.JSX.Element | null {
  const { sheet, setSheet, state, refresh, t, toast, setOsk } = useStore();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const open = sheet?.kind === 'admin';

  useEffect(() => {
    if (open) {
      setPassword('');
      setError(null);
    }
  }, [open]);

  const submit = useCallback(
    async (value: string) => {
      try {
        await api.login(value);
        // Le mot de passe accepté, on ressort du mode enfant : c'est la seule
        // raison de le demander.
        await api.setChildMode(false).catch(() => {});
        await refresh();
        toast(t.childModeOff);
        setSheet(null);
      } catch (err) {
        setError(
          err instanceof ApiError && err.code === 'password_too_short'
            ? t.passwordTooShort
            : t.wrongPassword,
        );
      }
    },
    [refresh, setSheet, t, toast],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'back') setSheet(null);
        else if (action === 'confirm') {
          setOsk({
            label: t.password,
            value: '',
            onCommit: (value) => void submit(value),
          });
        }
        return true;
      },
      [open, setSheet, setOsk, submit, t.password],
    ),
    open,
  );

  if (!open) return null;
  const isAdmin = state?.isAdmin ?? false;
  const childMode = state?.childMode ?? false;

  // Hors mode enfant, tout est ouvert : la fenêtre sert à entrer dans le mode,
  // pas à déverrouiller. On n'y demande donc jamais le mot de passe.
  if (!childMode) {
    return (
      <div className="overlay" onClick={() => setSheet(null)}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}>
          <div className="sheet-title">{t.childMode}</div>
          <div className="mini">{t.childModeHint}</div>
          <div className="form-actions">
            <button
              className="btn"
              onClick={() =>
                setOsk({
                  label: state?.adminPasswordSet ? t.changePassword : t.setPassword,
                  value: '',
                  onCommit: (value) => {
                    void api
                      .changePassword(value)
                      .then(() => toast(t.changePassword))
                      .catch(() => setError(t.passwordTooShort));
                  },
                })
              }
            >
              {state?.adminPasswordSet ? t.changePassword : t.setPassword}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                void api.setChildMode(true).then(refresh).then(() => toast(t.childModeOn));
                setSheet(null);
              }}
            >
              {t.startChildMode}
            </button>
          </div>
          {error && <div className="mini" style={{ color: '#ff9aad' }}>{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="overlay" onClick={() => setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t.childMode}</div>

        {isAdmin ? (
          <>
            <div className="mini">{t.childModeOnUnlocked}</div>
            <div className="form-actions">
              <button className="btn" onClick={() => setSheet(null)}>
                {t.cancel}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  void api.setChildMode(false).then(refresh).then(() => toast(t.childModeOff));
                  setSheet(null);
                }}
              >
                {t.endChildMode}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mini">{t.endChildModeHint}</div>
            <input
              className="text-input"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit(password);
              }}
            />
            {error && <div className="mini" style={{ color: '#ff9aad' }}>{error}</div>}
            <div className="form-actions">
              <button className="btn" onClick={() => setSheet(null)}>
                {t.cancel}
              </button>
              <button className="btn primary" onClick={() => void submit(password)}>
                {t.endChildMode}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function FoldersSheet(): React.JSX.Element | null {
  const { sheet, setSheet, state, settings, patchSettings, refresh, t, toast, setOsk } = useStore();
  const [path, setPath] = useState('');
  const [kind, setKind] = useState<Root['kind']>('photos');
  const [error, setError] = useState<string | null>(null);
  const open = sheet?.kind === 'folders';

  const add = useCallback(
    async (value: string) => {
      const target = value.trim();
      if (!target) return;
      try {
        await api.addRoot(target, kind);
        await refresh();
        setPath('');
        setError(null);
        if (kind === 'photos') void api.scan();
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'error');
      }
    },
    [kind, refresh],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'back') setSheet(null);
        else if (action === 'confirm') {
          setOsk({ label: t.folderPath, value: path, onCommit: (value) => void add(value) });
        }
        return true;
      },
      [open, setSheet, setOsk, t.folderPath, path, add],
    ),
    open,
  );

  if (!open) return null;
  const roots = state?.roots ?? [];
  const groups: Array<{ kind: Root['kind']; label: string }> = [
    { kind: 'photos', label: t.photoFolders },
    { kind: 'import', label: t.receiveFolder },
    { kind: 'music', label: t.musicFolder },
    { kind: 'ui', label: t.backgroundFolder },
  ];

  return (
    <div className="overlay" onClick={() => setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t.folders}</div>

        {groups.map((group) => (
          <div key={group.kind} className="field">
            <span className="lab">{group.label}</span>
            <div className="option-list">
              {roots
                .filter((r) => r.kind === group.kind)
                .map((root) => (
                  <div key={root.id} className="option">
                    <span className="n" style={{ wordBreak: 'break-all', fontSize: '0.84em' }}>
                      {root.path}
                    </span>
                    {!root.exists && <span className="c" style={{ color: '#ff9aad' }}>{t.missing}</span>}
                    <button
                      className="tiny-btn danger"
                      onClick={() => void api.removeRoot(root.id).then(refresh)}
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))}
              {roots.filter((r) => r.kind === group.kind).length === 0 && (
                <span className="mini">—</span>
              )}
            </div>
          </div>
        ))}

        <div className="field">
          <span className="lab">{t.addFolder}</span>
          <div className="slot-row">
            {groups.map((group) => (
              <button
                key={group.kind}
                className={`slot${kind === group.kind ? ' on' : ''}`}
                onClick={() => setKind(group.kind)}
              >
                {group.label}
              </button>
            ))}
          </div>
          <input
            className="text-input"
            placeholder={t.folderPath}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add(path);
            }}
          />
          {error && <div className="mini" style={{ color: '#ff9aad' }}>{error}</div>}
          {kind === 'music' && <div className="mini">{t.musicHint}</div>}
          {kind === 'import' && <div className="mini">{t.uploadHint}</div>}
        </div>

        <button
          className="option"
          onClick={() => patchSettings({ uploadRequiresAdmin: !settings.uploadRequiresAdmin })}
        >
          <span className="n">{t.uploadOpen}</span>
          <span className="c">{settings.uploadRequiresAdmin ? '○' : '●'}</span>
        </button>

        <div className="form-actions">
          <button
            className="btn"
            onClick={() => {
              void api.backfillPlaces().then((r) => toast(`${t.fixPlaces}: ${r.updated}`)).then(refresh);
            }}
          >
            {t.fixPlaces}
          </button>
          <button className="btn" onClick={() => void api.scan().then(() => toast(t.scanning))}>
            {t.rescan}
          </button>
          <button className="btn primary" onClick={() => void add(path)}>
            {t.add}
          </button>
        </div>
      </div>
    </div>
  );
}

// -------------------------------------------------------- ajouter à un album

export function AddToAlbumSheet(): React.JSX.Element | null {
  const { addToAlbumFor, setAddToAlbumFor, setPendingAlbumMedia, state, refresh, t, toast, openView } =
    useStore();
  const [cursor, setCursor] = useState(0);
  const open = addToAlbumFor !== null && addToAlbumFor.length > 0;
  const albums = state?.albums ?? [];

  const commit = useCallback(
    async (index: number) => {
      if (!addToAlbumFor) return;
      if (index === albums.length) {
        // L'album n'existe pas encore : on emporte la sélection avec nous, et
        // la création s'en occupera. Autrement il fallait tout recommencer une
        // fois l'album créé.
        setPendingAlbumMedia(addToAlbumFor);
        setAddToAlbumFor(null);
        openView({ kind: 'newAlbum' });
        return;
      }
      const album = albums[index];
      if (!album) return;
      await api.albumMedia(album.id, addToAlbumFor);
      await refresh();
      toast(`${addToAlbumFor.length} → ${album.kind === 'favorites' ? t.favorites : album.name}`);
      setAddToAlbumFor(null);
    },
    [addToAlbumFor, albums, refresh, setAddToAlbumFor, setPendingAlbumMedia, t.favorites, toast, openView],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        const length = albums.length + 1;
        if (action === 'up' || action === 'dec') setCursor((c) => wrap(c - 1, length));
        else if (action === 'down' || action === 'inc') setCursor((c) => wrap(c + 1, length));
        else if (action === 'confirm') void commit(cursor);
        else if (action === 'back') setAddToAlbumFor(null);
        return true;
      },
      [open, albums.length, cursor, commit, setAddToAlbumFor],
    ),
    open,
  );

  if (!open) return null;

  return (
    <div className="overlay" onClick={() => setAddToAlbumFor(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          {t.addToAlbum} · {addToAlbumFor?.length}
        </div>
        <div className="option-list">
          {albums.map((album, i) => (
            <button
              key={album.id}
              className={`option${i === cursor ? ' on' : ''}`}
              onClick={() => void commit(i)}
            >
              <span className="swatch" style={{ background: `hsl(${album.color} 88% 58%)` }} />
              {album.kind === 'favorites' && <IconHeart />}
              <span className="n">{album.kind === 'favorites' ? t.favorites : album.name}</span>
              <span className="c">{album.count}</span>
            </button>
          ))}
          <button
            className={`option${cursor === albums.length ? ' on' : ''}`}
            onClick={() => void commit(albums.length)}
          >
            <IconPlus />
            <span className="n">{t.newAlbum}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function TagEditorSheet(): React.JSX.Element | null {
  const { tagEditorFor, setTagEditorFor, state, refresh, t, setOsk, toast } = useStore();
  const [pending, setPending] = useState<string[]>([]);
  const [partial, setPartial] = useState<string[]>([]);
  const [start, setStart] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const open = tagEditorFor !== null && tagEditorFor.length > 0;
  const key = tagEditorFor?.join(',') ?? '';

  /**
   * On part de ce que la sélection porte déjà. Auparavant l'éditeur s'ouvrait
   * vide : impossible de voir les tags d'une photo, ni de lui en retirer un.
   * Avec plusieurs photos, on distingue les tags communs à toutes de ceux qui
   * n'en couvrent qu'une partie.
   */
  useEffect(() => {
    if (!open || !tagEditorFor) return;
    let alive = true;
    setInput('');
    void api
      .tagSummary(tagEditorFor)
      .then((summary) => {
        if (!alive) return;
        setPending(summary.all);
        setStart(summary.all);
        setPartial(summary.some);
      })
      .catch(() => {
        if (!alive) return;
        setPending([]);
        setStart([]);
        setPartial([]);
      });
    return () => {
      alive = false;
    };
  }, [open, key, tagEditorFor]);

  const apply = useCallback(
    async (add: string[], remove: string[]) => {
      if (!tagEditorFor) return;
      await api.tagMedia(tagEditorFor, add, remove);
      await refresh();
      toast(t.editTags);
    },
    [tagEditorFor, refresh, t.editTags, toast],
  );

  /** Enregistre l'écart entre ce qu'on avait en ouvrant et ce qu'on a maintenant. */
  const save = useCallback(async () => {
    const typed = input.trim();
    const next = typed && !pending.includes(typed) ? [...pending, typed] : pending;
    const add = next.filter((tag) => !start.includes(tag));
    // Un tag présent sur une partie seulement n'a pas été « enlevé » si on n'y a
    // pas touché : on ne retire que ce qui était commun à tout et ne l'est plus.
    const remove = start.filter((tag) => !next.includes(tag));
    await apply(add, remove);
    setTagEditorFor(null);
  }, [apply, input, pending, start, setTagEditorFor]);

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'back') setTagEditorFor(null);
        else if (action === 'confirm') {
          setOsk({
            label: t.addTag,
            value: '',
            onCommit: (value) => {
              if (value.trim()) setPending((p) => [...p, value.trim()]);
            },
          });
        }
        return true;
      },
      [open, setTagEditorFor, setOsk, t.addTag],
    ),
    open,
  );

  if (!open) return null;
  const count = tagEditorFor?.length ?? 0;
  // Tags de la bibliothèque qu'on n'a pas déjà sous la main.
  const known = (state?.tags ?? []).filter((tag) => !pending.includes(tag) && !partial.includes(tag));

  return (
    <div className="overlay" onClick={() => setTagEditorFor(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          {t.editTags} · {t.photoCount(count)}
        </div>

        <div className="field">
          <span className="lab">{count > 1 ? t.tagsOnAll : t.tagsOnPhoto}</span>
          <div className="chip-row">
            {pending.length === 0 && partial.length === 0 && <span className="mini">—</span>}
            {pending.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                onRemove={() => setPending((p) => p.filter((x) => x !== tag))}
              />
            ))}
            {/* Sur une partie seulement de la sélection : un clic l'étend à tout. */}
            {partial.map((tag) => (
              <TagChip
                key={tag}
                tag={tag}
                partial
                title={t.tagOnSome}
                onPick={() => {
                  setPartial((p) => p.filter((x) => x !== tag));
                  setPending((p) => (p.includes(tag) ? p : [...p, tag]));
                }}
                onRemove={() => {
                  setPartial((p) => p.filter((x) => x !== tag));
                  void apply([], [tag]);
                }}
              />
            ))}
            <input
              className="text-input"
              style={{ width: '14ch', flex: '0 0 auto' }}
              autoFocus
              value={input}
              placeholder={t.addTag}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                const tag = input.trim();
                if (e.key === 'Enter' && tag) {
                  setPending((p) => (p.includes(tag) ? p : [...p, tag]));
                  setInput('');
                }
              }}
            />
          </div>
        </div>

        {known.length > 0 && (
          <div className="field">
            <span className="lab">{t.otherTags}</span>
            <div className="chip-row">
              {known.map((tag) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  onPick={() => setPending((p) => (p.includes(tag) ? p : [...p, tag]))}
                />
              ))}
            </div>
          </div>
        )}

        <div className="form-actions">
          <button className="btn" onClick={() => setTagEditorFor(null)}>
            {t.cancel}
          </button>
          <button className="btn primary" onClick={() => void save()}>
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Un tag affiché à sa couleur, avec le nuancier au bout. Sans couleur choisie
 * il garde l'apparence neutre d'avant.
 */
export function TagChip({
  tag,
  partial = false,
  title,
  onPick,
  onRemove,
}: {
  tag: string;
  partial?: boolean;
  title?: string;
  onPick?: () => void;
  onRemove?: () => void;
}): React.JSX.Element {
  const { state, refresh, t } = useStore();
  const [picking, setPicking] = useState(false);
  const isAdmin = state?.isAdmin ?? false;
  const hue = state?.tagColors[tag];

  // Un clic ailleurs referme le nuancier : sinon en ouvrir un second en
  // laisserait deux à l'écran.
  useEffect(() => {
    if (!picking) return;
    const close = (): void => setPicking(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [picking]);
  const style = hue === undefined ? undefined : ({ ['--tag-hue' as string]: String(hue) });

  const choose = (next: number | null): void => {
    setPicking(false);
    void api.setTagColor(tag, next).then(refresh).catch(() => {});
  };

  return (
    <span className="tag-wrap">
      <span
        className={`chip tag${hue === undefined ? '' : ' tinted'}${partial ? ' part' : ''}`}
        style={style}
        title={title}
      >
        {onPick ? <button onClick={onPick}>{tag}</button> : <span>{tag}</span>}
        {isAdmin && (
          <button
            className="hue"
            title={t.tagColor}
            onClick={(e) => {
              e.stopPropagation();
              setPicking((v) => !v);
            }}
          >
            <IconPalette />
          </button>
        )}
        {onRemove && (
          <button className="x" title={t.remove} onClick={onRemove}>
            <IconX />
          </button>
        )}
      </span>

      {picking && (
        <span className="hue-pop" onClick={(e) => e.stopPropagation()}>
          <button className="hue-dot none" title={t.backgroundNone} onClick={() => choose(null)}>
            <IconX />
          </button>
          {HUES.map((h) => (
            <button
              key={h}
              className={`hue-dot${hue === h ? ' on' : ''}`}
              style={{ background: `hsl(${h} 85% 55%)` }}
              onClick={() => choose(h)}
            />
          ))}
        </span>
      )}
    </span>
  );
}

/** Ordre de la grille d'albums. Les épinglés restent en tête quoi qu'il arrive. */
export function AlbumSortSheet(): React.JSX.Element | null {
  const { sheet, setSheet, settings, patchSettings, refresh, t } = useStore();
  const open = sheet?.kind === 'albumSort';
  const options = useMemo(
    () =>
      [
        { id: 'recent', label: t.sortRecent },
        { id: 'name', label: t.sortName },
        { id: 'yearDesc', label: t.sortYearDesc },
        { id: 'yearAsc', label: t.sortYearAsc },
      ] as Array<{ id: AlbumSort; label: string }>,
    [t.sortRecent, t.sortName, t.sortYearDesc, t.sortYearAsc],
  );
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    if (!open) return;
    const found = options.findIndex((o) => o.id === settings.albumSort);
    setCursor(found >= 0 ? found : 0);
  }, [open, options, settings.albumSort]);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (option) {
        patchSettings({ albumSort: option.id });
        // Le tri est appliqué par le serveur : sans ce rafraîchissement la
        // grille garderait l'ordre précédent jusqu'au prochain scan.
        void api.saveSettings({ albumSort: option.id }).then(refresh).catch(() => {});
      }
      setSheet(null);
    },
    [options, patchSettings, refresh, setSheet],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'up' || action === 'dec') setCursor((c) => wrap(c - 1, options.length));
        else if (action === 'down' || action === 'inc') setCursor((c) => wrap(c + 1, options.length));
        else if (action === 'confirm') commit(cursor);
        else if (action === 'back') setSheet(null);
        return true;
      },
      [open, options.length, cursor, commit, setSheet],
    ),
    open,
  );

  if (!open) return null;

  return (
    <div className="overlay" onClick={() => setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t.sortAlbums}</div>
        <div className="option-list">
          {options.map((option, i) => (
            <button
              key={option.id}
              className={`option${i === cursor ? ' on' : ''}`}
              onClick={() => commit(i)}
            >
              <span className="n">{option.label}</span>
              {settings.albumSort === option.id && <IconCheck />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ menu contextuel

export interface MenuTarget {
  x: number;
  y: number;
  mediaId: number;
  /** Une vidéo n'offre pas la rotation. */
  kind: 'photo' | 'video';
  inAlbum: number | null;
  hidden: boolean;
  favorite: boolean;
}

export function ContextMenu({
  target,
  onClose,
  onOpen,
  onAddToAlbum,
  onToggleFavorite,
  onToggleHidden,
  onEditTags,
  onSelectMode,
  onRemoveFromAlbum,
  onSetCover,
  onRotate,
}: {
  target: MenuTarget;
  onClose: () => void;
  onOpen: () => void;
  onAddToAlbum: () => void;
  onToggleFavorite: () => void;
  onToggleHidden: () => void;
  onEditTags: () => void;
  onSelectMode: () => void;
  onRemoveFromAlbum: () => void;
  onSetCover: () => void;
  onRotate: () => void;
}): React.JSX.Element {
  const { t } = useStore();

  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const style = {
    left: Math.min(target.x, window.innerWidth - 230),
    top: Math.min(target.y, window.innerHeight - 320),
  };

  return (
    <div className="menu" style={style} onClick={(e) => e.stopPropagation()}>
      <button className="menu-item" onClick={onOpen}>
        <IconExpand /> {t.fullscreen}
      </button>
      <button className="menu-item" onClick={onToggleFavorite}>
        <IconHeart /> {t.favorites}
      </button>
      <button className="menu-item" onClick={onAddToAlbum}>
        <IconPlus /> {t.addToAlbum}
      </button>
      <button className="menu-item" onClick={onSelectMode}>
        <IconSelect /> {t.selectMode}
      </button>

      {/* Ces entrées restent visibles même verrouillé : c'est l'action qui
          propose alors de déverrouiller, plutôt qu'un menu qui rétrécit sans
          explication. */}
      <div className="menu-sep" />
      <button className="menu-item" onClick={onEditTags}>
        <IconTag /> {t.editTags}
      </button>
      {/* Les vidéos gardent leur orientation à la lecture : les tourner ne
          ferait qu'une vignette de travers par rapport au film. */}
      {target.kind === 'photo' && (
        <button className="menu-item" onClick={onRotate}>
          <IconRotate /> {t.rotate}
        </button>
      )}
      {target.inAlbum !== null && (
        <>
          <button className="menu-item" onClick={onSetCover}>
            <IconPencil /> {t.setCover}
          </button>
          <button className="menu-item" onClick={onRemoveFromAlbum}>
            <IconX /> {t.removeFromAlbum}
          </button>
        </>
      )}
      <button className="menu-item" onClick={onToggleHidden}>
        <IconHide /> {target.hidden ? t.unhide : t.hide}
      </button>
    </div>
  );
}

export interface AlbumMenuTarget {
  x: number;
  y: number;
  albumId: number;
}

/** Clic droit sur une carte d'album : ses tags et sa fiche, sans l'ouvrir. */
export function AlbumContextMenu({
  target,
  onClose,
  onOpen,
  onEdit,
  onEditTags,
  onTogglePin,
}: {
  target: AlbumMenuTarget;
  onClose: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onEditTags: () => void;
  onTogglePin: () => void;
}): React.JSX.Element {
  const { t, state } = useStore();
  const album = state?.albums.find((a) => a.id === target.albumId);

  useEffect(() => {
    const close = (): void => onClose();
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  const style = {
    left: Math.min(target.x, window.innerWidth - 230),
    top: Math.min(target.y, window.innerHeight - 200),
  };

  return (
    <div className="menu" style={style} onClick={(e) => e.stopPropagation()}>
      <button className="menu-item" onClick={onOpen}>
        <IconExpand /> {t.open}
      </button>
      <div className="menu-sep" />
      {/* Les favoris sont déjà en tête d'office : rien à épingler. */}
      {album?.kind !== 'favorites' && (
        <button className="menu-item" onClick={onTogglePin}>
          <IconPin /> {album?.pinned ? t.unpin : t.pin}
        </button>
      )}
      <button className="menu-item" onClick={onEditTags}>
        <IconTag /> {t.editTags}
      </button>
      {/* Les favoris sont un album à part : pas de fiche à modifier. */}
      {album?.kind !== 'favorites' && (
        <button className="menu-item" onClick={onEdit}>
          <IconPencil /> {t.editAlbum}
        </button>
      )}
    </div>
  );
}

/**
 * Tags d'un album. À la différence des photos, un album porte une liste
 * complète : on l'enregistre telle quelle plutôt que par ajouts et retraits.
 */
export function AlbumTagsSheet(): React.JSX.Element | null {
  const { albumTagsFor, setAlbumTagsFor, state, refresh, t, setOsk, toast } = useStore();
  const album = state?.albums.find((a) => a.id === albumTagsFor) ?? null;
  const [pending, setPending] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const open = album !== null;
  // Les tags au moment de l'ouverture. Depuis un ref, parce que l'objet album
  // est recree a chaque rafraichissement de l'etat : en dependre effacerait la
  // saisie en cours.
  const tagsAtOpen = useRef<string[]>([]);
  tagsAtOpen.current = album?.tags ?? [];

  useEffect(() => {
    if (albumTagsFor === null) return;
    setPending(tagsAtOpen.current);
    setInput('');
  }, [albumTagsFor]);

  const save = useCallback(
    async (tags: string[]) => {
      if (!album) return;
      await api.updateAlbum(album.id, { tags });
      await refresh();
      toast(t.editTags);
      setAlbumTagsFor(null);
    },
    [album, refresh, setAlbumTagsFor, t.editTags, toast],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'back') setAlbumTagsFor(null);
        else if (action === 'confirm') {
          setOsk({
            label: t.addTag,
            value: '',
            onCommit: (value) => {
              const tag = value.trim();
              if (tag) setPending((p) => (p.includes(tag) ? p : [...p, tag]));
            },
          });
        }
        return true;
      },
      [open, setAlbumTagsFor, setOsk, t.addTag],
    ),
    open,
  );

  if (!open || !album) return null;
  const known = (state?.tags ?? []).filter((tag) => !pending.includes(tag));

  return (
    <div className="overlay" onClick={() => setAlbumTagsFor(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">
          {t.editTags} · {album.kind === 'favorites' ? t.favorites : album.name}
        </div>

        <div className="chip-row">
          {pending.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              onRemove={() => setPending((p) => p.filter((x) => x !== tag))}
            />
          ))}
          <input
            className="text-input"
            style={{ width: '14ch', flex: '0 0 auto' }}
            autoFocus
            value={input}
            placeholder={t.addTag}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              const tag = input.trim();
              if (e.key === 'Enter' && tag) {
                setPending((p) => (p.includes(tag) ? p : [...p, tag]));
                setInput('');
              }
            }}
          />
        </div>

        {known.length > 0 && (
          <div className="field">
            <span className="lab">{t.tags}</span>
            <div className="chip-row">
              {known.map((tag) => (
                <TagChip key={tag} tag={tag} onPick={() => setPending((p) => [...p, tag])} />
              ))}
            </div>
          </div>
        )}

        <div className="form-actions">
          <button className="btn" onClick={() => setAlbumTagsFor(null)}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              const tag = input.trim();
              void save(tag && !pending.includes(tag) ? [...pending, tag] : pending);
            }}
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------- clavier à l'écran

const OSK_ROWS: Array<Array<{ key: string; label?: string; span?: number }>> = [
  '1234567890'.split('').map((key) => ({ key })),
  'qwertyuiop'.split('').map((key) => ({ key })),
  'asdfghjkl-'.split('').map((key) => ({ key })),
  'zxcvbnm,._'.split('').map((key) => ({ key })),
  [
    { key: 'ACTION:shift', label: 'ABC', span: 2 },
    { key: ' ', label: '␣', span: 4 },
    { key: 'ACTION:back', label: '⌫', span: 2 },
    { key: 'ACTION:done', label: 'OK', span: 2 },
  ],
];

/**
 * Clavier affiché quand on valide un champ texte à la manette. À la souris ou au
 * clavier physique, on tape directement dans le champ — ce panneau ne s'ouvre
 * que si on le demande.
 */
export function Osk(): React.JSX.Element | null {
  const { osk, setOsk, t } = useStore();
  const [value, setValue] = useState('');
  const [row, setRow] = useState(1);
  const [col, setCol] = useState(0);
  const [shift, setShift] = useState(false);

  useEffect(() => {
    if (osk) {
      setValue(osk.value);
      setRow(1);
      setCol(0);
      setShift(false);
    }
  }, [osk]);

  const press = useCallback(
    (key: string) => {
      if (key === 'ACTION:shift') {
        setShift((s) => !s);
        return;
      }
      if (key === 'ACTION:back') {
        setValue((v) => v.slice(0, -1));
        return;
      }
      if (key === 'ACTION:done') {
        osk?.onCommit(value);
        setOsk(null);
        return;
      }
      setValue((v) => v + (shift ? key.toUpperCase() : key));
      if (shift) setShift(false);
    },
    [osk, value, shift, setOsk],
  );

  useInput(
    useCallback(
      (action) => {
        if (!osk) return false;
        if (action === 'up') setRow((r) => wrap(r - 1, OSK_ROWS.length));
        else if (action === 'down') setRow((r) => wrap(r + 1, OSK_ROWS.length));
        else if (action === 'left') setCol((c) => wrap(c - 1, OSK_ROWS[row].length));
        else if (action === 'right') setCol((c) => wrap(c + 1, OSK_ROWS[row].length));
        else if (action === 'confirm') press(OSK_ROWS[row][Math.min(col, OSK_ROWS[row].length - 1)].key);
        else if (action === 'actionX') setValue((v) => v.slice(0, -1));
        else if (action === 'actionY') {
          osk.onCommit(value);
          setOsk(null);
        } else if (action === 'back') setOsk(null);
        return true;
      },
      [osk, row, col, press, value, setOsk],
    ),
    osk !== null,
  );

  if (!osk) return null;

  return (
    <div className="overlay" onClick={() => setOsk(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{osk.label}</div>
        <input
          className="text-input"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              osk.onCommit(value);
              setOsk(null);
            }
          }}
        />
        <div className="osk-keys">
          {OSK_ROWS.map((keys, r) =>
            keys.map((entry, c) => (
              <button
                key={`${r}-${entry.key}`}
                className={`key${entry.span ? ' wide' : ''}${r === row && c === col ? ' on' : ''}`}
                style={entry.span ? { gridColumn: `span ${entry.span}` } : undefined}
                onClick={() => {
                  setRow(r);
                  setCol(c);
                  press(entry.key);
                }}
              >
                {entry.label ?? (shift ? entry.key.toUpperCase() : entry.key)}
              </button>
            )),
          )}
        </div>
        <div className="form-actions">
          <button className="btn" onClick={() => setOsk(null)}>
            {t.cancel}
          </button>
          <button
            className="btn primary"
            onClick={() => {
              osk.onCommit(value);
              setOsk(null);
            }}
          >
            {t.save}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Toasts(): React.JSX.Element {
  const { toasts } = useStore();
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
