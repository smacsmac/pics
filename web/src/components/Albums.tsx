import { useEffect, useRef, useState } from 'react';
import type { Album, MediaItem } from '../../../shared/types';
import { api } from '../lib/api';
import { HUES, VOLUME_MAX } from '../lib/panels';
import { useStore } from '../lib/store';
import { IconAlbum, IconPencil, IconTrash, IconX } from './Icons';

/** Champs traversables d'un formulaire d'album (nav.contentIndex les indexe). */
export type AlbumField =
  | 'name' | 'cover' | 'color' | 'music' | 'videoMusic'
  | 'background' | 'backgroundOpacity' | 'tags' | 'submit';

/**
 * La couverture ne se choisit que sur un album existant, puisqu'il faut ses
 * photos pour en désigner une. Le champ disparaît donc à la création plutôt que
 * de rester là, vide et inatteignable.
 */
export function albumFields(editing: boolean): AlbumField[] {
  const fields: AlbumField[] = ['name'];
  if (editing) fields.push('cover');
  fields.push('color', 'music', 'videoMusic', 'background', 'backgroundOpacity', 'tags', 'submit');
  return fields;
}

export function AlbumsGrid({
  albums,
  onOpen,
  onEdit,
}: {
  albums: Album[];
  onOpen: (album: Album) => void;
  onEdit: (album: Album) => void;
}): React.JSX.Element {
  const { nav, t } = useStore();
  const focusIndex = nav.zone === 'content' ? nav.contentIndex : -1;

  return (
    <div className="albums-grid">
      {albums.map((album, i) => (
        <div
          key={album.id}
          className={`album-card${focusIndex === i ? ' focus' : ''}`}
          style={{ ['--card-hue' as string]: String(album.color) }}
          data-flat={i}
          onClick={() => onOpen(album)}
        >
          {album.coverMediaId ? (
            <img className="cover" src={api.thumbUrl(album.coverMediaId, 480)} alt="" loading="lazy" />
          ) : (
            <div className="cover" style={{ display: 'grid', placeItems: 'center' }}>
              <IconAlbum />
            </div>
          )}

          {album.kind === 'favorites' && <span className="fav-tag">★ {t.favorites}</span>}

          {/* Toujours affiché : verrouillé, le clic propose de déverrouiller
              plutôt que de faire disparaître le bouton sans explication. */}
          {album.kind !== 'favorites' && (
            <button
              className="edit-btn"
              title={t.editAlbum}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(album);
              }}
            >
              <IconPencil />
            </button>
          )}

          <div className="meta">
            <div className="n">{album.kind === 'favorites' ? t.favorites : album.name}</div>
            <div className="c">
              {t.photoCount(album.count)}
              {album.tags.length > 0 && ` · ${album.tags.join(' · ')}`}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export interface AlbumDraft {
  name: string;
  color: number;
  musicSlot: number | null;
  /** Volume de la musique pendant une vidéo, en % du volume global. */
  videoMusicPct: number;
  background: string | null;
  backgroundOpacity: number;
  coverMediaId: number | null;
  tags: string[];
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * Formulaire partagé entre « nouvel album » et « modifier l'album ».
 * La position dans le formulaire vient de nav.contentIndex, donc les mêmes
 * touches servent ici et dans la grille de photos.
 */
export function AlbumForm({
  title,
  draft,
  setDraft,
  onSubmit,
  onCancel,
  onDelete,
  submitLabel,
  albumId,
}: {
  title: string;
  draft: AlbumDraft;
  setDraft: (update: (d: AlbumDraft) => AlbumDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitLabel: string;
  /** Défini en modification : sert à charger les photos pour la couverture. */
  albumId?: number;
}): React.JSX.Element {
  const { nav, state, t, setOsk, pendingAlbumMedia } = useStore();
  // Album créé depuis une sélection : on annonce ce qui va y entrer, sinon
  // rien à l'écran ne dit que les photos suivront.
  const waiting = albumId === undefined ? (pendingAlbumMedia?.length ?? 0) : 0;
  const fields = albumFields(albumId !== undefined);
  const field = fields[nav.zone === 'content' ? nav.contentIndex : -1];
  const [covers, setCovers] = useState<MediaItem[]>([]);

  useEffect(() => {
    if (albumId === undefined) return;
    let alive = true;
    void api
      .media({ album: albumId, limit: 120 })
      .then((page) => {
        if (alive) setCovers(page.items.filter((i) => i.kind === 'photo'));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [albumId]);
  const slots = state?.musicSlots ?? [];
  const backgrounds = state?.backgrounds ?? [];
  const [tagInput, setTagInput] = useState('');

  const addTag = (raw: string): void => {
    const value = raw.trim();
    if (!value) return;
    setDraft((d) => (d.tags.includes(value) ? d : { ...d, tags: [...d.tags, value] }));
    setTagInput('');
  };

  return (
    <div className="form-card">
      <div className="form-title">{title}</div>
      {waiting > 0 && <div className="form-note">{t.willJoinAlbum(waiting)}</div>}

      <div className={`field${field === 'name' ? ' on' : ''}`}>
        <span className="lab">{t.name}</span>
        <input
          className="text-input"
          value={draft.name}
          placeholder={t.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

      {albumId !== undefined && (
        <div className={`field${field === 'cover' ? ' on' : ''}`}>
          <span className="lab">{t.coverField}</span>
          {covers.length === 0 ? (
            <span className="mini">{t.coverAfterCreate}</span>
          ) : (
            <div className="cover-row">
              {covers.map((item) => (
                <button
                  key={item.id}
                  className={`cover-chip${draft.coverMediaId === item.id ? ' on' : ''}`}
                  style={{ backgroundImage: `url(${api.thumbUrl(item.id, 240)})` }}
                  title={item.filename}
                  onClick={() => setDraft((d) => ({ ...d, coverMediaId: item.id }))}
                />
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`field${field === 'color' ? ' on' : ''}`}>
        <span className="lab">{t.color}</span>
        <div className="hues">
          {HUES.map((hue) => (
            <button
              key={hue}
              className={`hue-chip${draft.color === hue ? ' on' : ''}`}
              style={{ background: `hsl(${hue} 88% 58%)`, color: `hsl(${hue} 100% 62%)` }}
              onClick={() => setDraft((d) => ({ ...d, color: hue }))}
              aria-label={`${t.color} ${hue}`}
            />
          ))}
        </div>
      </div>

      <div className={`field${field === 'music' ? ' on' : ''}`}>
        <span className="lab">{t.music}</span>
        <div className="slot-row">
          <button
            className={`slot${draft.musicSlot === null ? ' on' : ''}`}
            onClick={() => setDraft((d) => ({ ...d, musicSlot: null }))}
          >
            {t.noMusic}
          </button>
          {[1, 2, 3, 4, 5].map((slot) => (
            <button
              key={slot}
              className={`slot${draft.musicSlot === slot ? ' on' : ''}${slots.includes(slot) ? '' : ' off'}`}
              title={slots.includes(slot) ? `${slot}.mp3` : t.missing}
              onClick={() => setDraft((d) => ({ ...d, musicSlot: slot }))}
            >
              {slot}
            </button>
          ))}
        </div>
        {slots.length === 0 && <span className="mini">{t.musicNoFolder}</span>}
      </div>

      <div className={`field${field === 'videoMusic' ? ' on' : ''}`}>
        <span className="lab">{t.videoMusic}</span>
        <div className="pct">
          <input
            className="text-input"
            inputMode="numeric"
            value={draft.videoMusicPct}
            aria-label={t.videoMusic}
            onChange={(e) => {
              // On accepte la saisie brute (y compris vide) et on borne à la sortie.
              const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
              setDraft((d) => ({ ...d, videoMusicPct: digits === '' ? 0 : clampPercent(Number(digits)) }));
            }}
            onFocus={(e) => e.target.select()}
          />
          <span className="unit">%</span>
          <span className="mini">{t.videoMusicHint}</span>
        </div>
      </div>

      <div className={`field${field === 'background' ? ' on' : ''}`}>
        <span className="lab">{t.background}</span>
        {backgrounds.length === 0 ? (
          <span className="mini">{t.backgroundNoFolder}</span>
        ) : (
          <div className="bg-row">
            <button
              className={`bg-chip none${draft.background === null ? ' on' : ''}`}
              onClick={() => setDraft((d) => ({ ...d, background: null }))}
            >
              {t.backgroundNone}
            </button>
            {backgrounds.map((name) => (
              <button
                key={name}
                className={`bg-chip${draft.background === name ? ' on' : ''}`}
                style={{ backgroundImage: `url(${api.backgroundUrl(name)})` }}
                title={name}
                onClick={() => setDraft((d) => ({ ...d, background: name }))}
              />
            ))}
          </div>
        )}
      </div>

      <div className={`field${field === 'backgroundOpacity' ? ' on' : ''}`}>
        <span className="lab">{t.backgroundOpacity}</span>
        <div className="pct">
          <input
            className="text-input"
            inputMode="numeric"
            value={draft.backgroundOpacity}
            aria-label={t.backgroundOpacity}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '').slice(0, 3);
              setDraft((d) => ({
                ...d,
                backgroundOpacity: digits === '' ? 0 : clampPercent(Number(digits)),
              }));
            }}
            onFocus={(e) => e.target.select()}
          />
          <span className="unit">%</span>
          {draft.background && (
            <span
              className="bg-preview"
              style={{ backgroundImage: `url(${api.backgroundUrl(draft.background)})` }}
            >
              <span style={{ opacity: 1 - draft.backgroundOpacity / 100 }} />
            </span>
          )}
        </div>
      </div>

      <div className={`field${field === 'tags' ? ' on' : ''}`}>
        <span className="lab">{t.tags}</span>
        <div className="chip-row">
          {draft.tags.map((tag) => (
            <span key={tag} className="chip on">
              {tag}
              <button
                className="x"
                onClick={() => setDraft((d) => ({ ...d, tags: d.tags.filter((x) => x !== tag) }))}
                aria-label={t.remove}
              >
                <IconX />
              </button>
            </span>
          ))}
          <input
            className="text-input"
            style={{ width: '11ch', flex: '0 0 auto' }}
            value={tagInput}
            placeholder={t.addTag}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag(tagInput);
              }
            }}
          />
          <button
            className="tiny-btn"
            onClick={() =>
              setOsk({ label: t.addTag, value: '', onCommit: (value) => addTag(value) })
            }
          >
            ⌨
          </button>
        </div>
        {(state?.tags.length ?? 0) > 0 && (
          <div className="chip-row">
            {state?.tags
              .filter((tag) => !draft.tags.includes(tag))
              .slice(0, 12)
              .map((tag) => (
                <button key={tag} className="chip" onClick={() => addTag(tag)}>
                  {tag}
                </button>
              ))}
          </div>
        )}
      </div>

      <div className="form-actions">
        {onDelete && (
          <button className="btn danger" onClick={onDelete}>
            <IconTrash /> {t.deleteAlbum}
          </button>
        )}
        <button className="btn" onClick={onCancel}>
          {t.cancel}
        </button>
        <button
          className={`btn primary${field === 'submit' ? ' on' : ''}`}
          onClick={onSubmit}
          disabled={draft.name.trim() === ''}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * Joue la piste d'un album, au volume global (0 = muet).
 *
 * `duckPct` non nul baisse la musique pendant qu'une vidéo est à l'écran, pour
 * qu'on entende le son de la vidéo. La transition est fondue sur un quart de
 * seconde : un saut de volume brutal s'entend plus que la musique elle-même.
 */
export function AlbumMusic({
  slot,
  duckPct,
}: {
  slot: number | null;
  duckPct: number | null;
}): null {
  const { settings, t, toast } = useStore();
  const [audio] = useState(() => (typeof Audio === 'undefined' ? null : new Audio()));
  const warned = useRef(false);
  const ramp = useRef<number | null>(null);

  const targetVolume = Math.min(
    1,
    Math.max(0, (settings.volume / VOLUME_MAX) * (duckPct === null ? 1 : duckPct / 100)),
  );

  useEffect(() => {
    if (!audio) return;
    audio.loop = true;
    return () => {
      audio.pause();
      audio.src = '';
    };
  }, [audio]);

  useEffect(() => {
    if (!audio) return;
    if (ramp.current !== null) cancelAnimationFrame(ramp.current);
    const from = audio.volume;
    const started = performance.now();
    const DURATION = 260;
    const step = (now: number): void => {
      const k = Math.min(1, (now - started) / DURATION);
      audio.volume = Math.min(1, Math.max(0, from + (targetVolume - from) * k));
      ramp.current = k < 1 ? requestAnimationFrame(step) : null;
    };
    ramp.current = requestAnimationFrame(step);
    return () => {
      if (ramp.current !== null) cancelAnimationFrame(ramp.current);
    };
  }, [audio, targetVolume]);

  useEffect(() => {
    if (!audio) return;
    // Volume global à zéro : on arrête vraiment. Une simple atténuation, elle,
    // garde la lecture en cours pour ne pas perdre la position dans le morceau.
    if (slot === null || settings.volume === 0) {
      audio.pause();
      return;
    }
    const url = api.musicUrl(slot);
    if (!audio.src.endsWith(url)) audio.src = url;

    void audio.play().catch(() => {
      // Le navigateur refuse de jouer tant que la page n'a reçu aucune
      // interaction. Plutôt qu'un silence inexpliqué, on le dit une fois et on
      // repart au premier geste — clic, touche ou bouton de manette.
      if (!warned.current) {
        warned.current = true;
        toast(t.musicBlocked);
      }
      const resume = (): void => {
        void audio.play().catch(() => {});
      };
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    });
  }, [audio, slot, settings.volume, t.musicBlocked, toast]);

  return null;
}
