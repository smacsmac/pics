import { useEffect, useRef, useState } from 'react';
import type { Album } from '../../../shared/types';
import { api } from '../lib/api';
import { HUES, VOLUME_MAX } from '../lib/panels';
import { useStore } from '../lib/store';
import { IconAlbum, IconPencil, IconTrash, IconX } from './Icons';

/** Champs traversables d'un formulaire d'album (nav.contentIndex les indexe). */
export const ALBUM_FIELDS = ['name', 'color', 'music', 'tags', 'submit'] as const;
export type AlbumField = (typeof ALBUM_FIELDS)[number];

export function AlbumsGrid({
  albums,
  onOpen,
  onEdit,
}: {
  albums: Album[];
  onOpen: (album: Album) => void;
  onEdit: (album: Album) => void;
}): React.JSX.Element {
  const { nav, t, state } = useStore();
  const focusIndex = nav.zone === 'content' ? nav.contentIndex : -1;
  const isAdmin = state?.isAdmin ?? false;

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

          {isAdmin && album.kind !== 'favorites' && (
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
  tags: string[];
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
}: {
  title: string;
  draft: AlbumDraft;
  setDraft: (update: (d: AlbumDraft) => AlbumDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onDelete?: () => void;
  submitLabel: string;
}): React.JSX.Element {
  const { nav, state, t, setOsk } = useStore();
  const field = ALBUM_FIELDS[nav.zone === 'content' ? nav.contentIndex : -1];
  const slots = state?.musicSlots ?? [];
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

      <div className={`field${field === 'name' ? ' on' : ''}`}>
        <span className="lab">{t.name}</span>
        <input
          className="text-input"
          value={draft.name}
          placeholder={t.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
        />
      </div>

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

/** Joue la piste d'un album, au volume global (0 = muet). */
export function AlbumMusic({ slot }: { slot: number | null }): null {
  const { settings, t, toast } = useStore();
  const [audio] = useState(() => (typeof Audio === 'undefined' ? null : new Audio()));
  const warned = useRef(false);

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
    if (slot === null || settings.volume === 0) {
      audio.pause();
      return;
    }
    const url = api.musicUrl(slot);
    if (!audio.src.endsWith(url)) audio.src = url;
    audio.volume = Math.min(1, Math.max(0, settings.volume / VOLUME_MAX));

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
