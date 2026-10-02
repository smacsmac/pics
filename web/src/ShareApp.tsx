import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Lang, MediaItem, PlaybackInfo, SharedAlbum } from '../../shared/types';
import { IconCheck, IconDownload, IconLeft, IconPlay, IconRight, IconSelect, IconX } from './components/Icons';
import { ApiError } from './lib/api';
import { formatDateTime, LANGS, dict } from './lib/i18n';
import { formatBytes, formatDuration } from './lib/format';
import { shareApi, type ShareApi } from './lib/share-api';

/**
 * La page qu'un invité voit au bout d'un lien de partage.
 *
 * Un arbre de composants à part, et non un mode de `App.tsx` : l'application
 * entière est construite sur `useStore()`, qui lit `/api/state` — justement la
 * route qu'un visiteur distant n'a pas le droit d'atteindre. Lui fabriquer un
 * faux état aurait demandé de simuler des réglages, des albums et des droits
 * d'admin pour quelqu'un qui n'en a aucun ; chaque oubli serait devenu une
 * fonction à moitié câblée, ou une fuite.
 *
 * Ce fichier ne sait donc faire que quatre choses : demander un mot de passe,
 * montrer une grille, ouvrir une photo en grand, et emporter une copie.
 */

/** Largeur visée pour une vignette, d'où le nombre de colonnes. */
const TILE_PX = 210;

function useColumns(): number {
  const [cols, setCols] = useState(4);
  useEffect(() => {
    const measure = (): void => {
      const width = Math.min(window.innerWidth - 32, 1600);
      setCols(Math.max(2, Math.min(8, Math.round(width / TILE_PX))));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  return cols;
}

export function ShareApp({ token }: { token: string }): React.JSX.Element {
  const api = useMemo<ShareApi>(() => shareApi(token), [token]);
  const [info, setInfo] = useState<SharedAlbum | null>(null);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState<Lang>('fr');
  const t = dict(lang);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const got = await api.info();
      setInfo(got);
      // La langue de la maison sert de point de départ ; l'invité peut changer.
      if (got.lang) setLang(got.lang);
      if (got.open) setItems(await api.media());
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'error');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  // La teinte de l'album, pour que la page partagée garde sa couleur.
  useEffect(() => {
    if (info?.color !== undefined) {
      document.documentElement.style.setProperty('--hue', String(info.color));
    }
    document.documentElement.lang = lang;
  }, [info?.color, lang]);

  const picker = (
    <div className="share-langs">
      {LANGS.map((l) => (
        <button
          key={l.code}
          className={`tiny-btn${lang === l.code ? ' on' : ''}`}
          onClick={() => setLang(l.code)}
          title={l.label}
        >
          {l.short}
        </button>
      ))}
    </div>
  );

  if (loading && info === null) {
    return <div className="share-center">{t.loading}</div>;
  }

  if (error !== null || info === null) {
    return (
      <div className="share-center">
        <div className="share-gate">
          <div className="sheet-title">{t.shareGoneTitle}</div>
          <p className="mini">{t.shareGone}</p>
          {picker}
        </div>
      </div>
    );
  }

  if (!info.open) {
    return <PasswordGate api={api} t={t} onOpen={load} picker={picker} />;
  }

  return (
    <ShareGallery
      api={api}
      t={t}
      info={info}
      items={items}
      lang={lang}
      picker={picker}
    />
  );
}

// ------------------------------------------------------------- mot de passe

function PasswordGate({
  api, t, onOpen, picker,
}: {
  api: ShareApi;
  t: ReturnType<typeof dict>;
  onOpen: () => void;
  picker: React.JSX.Element;
}): React.JSX.Element {
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (value.trim() === '' || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.open(value);
      onOpen();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'error';
      setProblem(code === 'too_many_attempts' ? t.shareTooMany : t.wrongPassword);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="share-center">
      <form
        className="share-gate"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="sheet-title">{t.sharedAlbum}</div>
        <p className="mini">{t.shareLocked}</p>
        <input
          className="text-input"
          type="password"
          value={value}
          placeholder={t.password}
          autoFocus
          autoComplete="current-password"
          onChange={(e) => setValue(e.target.value)}
        />
        {problem !== null && <p className="share-problem">{problem}</p>}
        <button className="btn primary" type="submit" disabled={busy || value.trim() === ''}>
          {busy ? t.loading : t.shareEnter}
        </button>
        {picker}
      </form>
    </div>
  );
}

// ------------------------------------------------------------------ galerie

function ShareGallery({
  api, t, info, items, lang, picker,
}: {
  api: ShareApi;
  t: ReturnType<typeof dict>;
  info: SharedAlbum;
  items: MediaItem[];
  lang: Lang;
  picker: React.JSX.Element;
}): React.JSX.Element {
  const cols = useColumns();
  const [selectMode, setSelectMode] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);

  const toggle = (id: number): void => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /**
   * Le téléchargement passe par un lien suivi par le navigateur, pas par
   * `fetch` : c'est lui qui sait écrire un fichier de plusieurs gigaoctets sur
   * le disque, là où `fetch` devrait d'abord tout garder en mémoire.
   */
  const download = (ids?: number[]): void => {
    window.location.href = api.downloadUrl(ids);
  };

  const ordered = useMemo(() => items.map((i) => i.id), [items]);

  return (
    <div className="share-page">
      <header className="share-head">
        <div className="share-title">
          <h1>{info.name}</h1>
          <span className="mini">
            {t.photoCount(info.count ?? items.length)}
            {info.expiresAt ? ` · ${t.shareUntil(formatDateTime(info.expiresAt, lang))}` : ''}
          </span>
        </div>

        <div className="share-tools">
          {picker}
          <button
            className={`btn${selectMode ? ' on' : ''}`}
            onClick={() => {
              setSelectMode((on) => !on);
              setPicked(new Set());
            }}
          >
            <IconSelect /> {selectMode ? t.cancel : t.selectMode}
          </button>
          {info.allowDownload !== false && (
            <button
              className="btn primary"
              onClick={() => download(selectMode && picked.size > 0 ? [...picked] : undefined)}
            >
              <IconDownload />{' '}
              {selectMode && picked.size > 0 ? `${t.download} ${picked.size}` : t.shareDownloadAll}
            </button>
          )}
        </div>
      </header>

      {selectMode && (
        <div className="share-bar">
          <button className="tiny-btn" onClick={() => setPicked(new Set(ordered))}>
            {t.selectAll}
          </button>
          <button className="tiny-btn" onClick={() => setPicked(new Set())}>
            {t.cancel}
          </button>
          <span className="mini">{t.photoCount(picked.size)}</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="share-center">
          <span className="mini">{t.emptyAlbum}</span>
        </div>
      ) : (
        <div
          className="grid share-grid"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {items.map((item, index) => (
            <Tile
              key={item.id}
              api={api}
              item={item}
              picked={picked.has(item.id)}
              selectMode={selectMode}
              onPick={() => (selectMode ? toggle(item.id) : setOpen(index))}
            />
          ))}
        </div>
      )}

      <footer className="share-foot mini">{t.shareFooter}</footer>

      {open !== null && items[open] && (
        <Viewer
          api={api}
          t={t}
          lang={lang}
          items={items}
          index={open}
          allowDownload={info.allowDownload !== false}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
          onDownload={(id) => download([id])}
        />
      )}
    </div>
  );
}

function Tile({
  api, item, picked, selectMode, onPick,
}: {
  api: ShareApi;
  item: MediaItem;
  picked: boolean;
  selectMode: boolean;
  onPick: () => void;
}): React.JSX.Element {
  const [broken, setBroken] = useState(false);

  return (
    <div className={`tile${picked ? ' picked' : ''}`} onClick={onPick}>
      {!broken ? (
        <img
          src={api.thumbUrl(item.id, 480)}
          alt={item.filename}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setBroken(true)}
        />
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--muted)' }}>
          <IconPlay />
        </div>
      )}

      {item.kind === 'video' && item.duration !== null && (
        <span className="dur">{formatDuration(item.duration)}</span>
      )}
      {selectMode && (
        <span className={`pick-dot${picked ? ' on' : ''}`}>{picked && <IconCheck />}</span>
      )}
    </div>
  );
}

// --------------------------------------------------------------- plein écran

function Viewer({
  api, t, lang, items, index, allowDownload, onIndex, onClose, onDownload,
}: {
  api: ShareApi;
  t: ReturnType<typeof dict>;
  lang: Lang;
  items: MediaItem[];
  index: number;
  allowDownload: boolean;
  onIndex: (next: number) => void;
  onClose: () => void;
  onDownload: (id: number) => void;
}): React.JSX.Element {
  const item = items[index];
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const touchStart = useRef<number | null>(null);

  const go = useCallback(
    (delta: number) => {
      const n = items.length;
      onIndex(((index + delta) % n + n) % n);
    },
    [index, items.length, onIndex],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // Une vidéo de téléphone n'est pas toujours lisible telle quelle : le serveur
  // dit s'il faut lire l'original ou une copie, et si elle est encore en route.
  useEffect(() => {
    if (item?.kind !== 'video') {
      setPlayback(null);
      return;
    }
    let cancelled = false;
    void api
      .playback(item.id)
      .then((got) => {
        if (!cancelled) setPlayback(got);
      })
      .catch(() => {
        if (!cancelled) setPlayback(null);
      });
    return () => {
      cancelled = true;
    };
  }, [api, item]);

  if (!item) return <></>;
  const rot = item.rotation ? ` rot rot${item.rotation}` : '';

  return (
    <div
      className="viewer"
      onTouchStart={(e) => {
        touchStart.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const from = touchStart.current;
        const to = e.changedTouches[0]?.clientX;
        if (from === null || to === undefined) return;
        if (Math.abs(to - from) > 60) go(to < from ? 1 : -1);
        touchStart.current = null;
      }}
    >
      {item.kind === 'video' ? (
        <>
          {/* Le serveur a deja reecrit l'adresse pour l'invite : on la suit
              telle quelle plutot que de la reconstruire ici. */}
          <video
            key={item.id}
            className="share-shot"
            src={playback?.url ?? undefined}
            poster={api.thumbUrl(item.id, 960)}
            controls
            playsInline
            autoPlay
          />
          {/* Une video de telephone se convertit avant d'etre lisible. Sans ce
              mot, l'invite ne voit qu'un rectangle noir et croit a une panne. */}
          {playback?.state === 'working' && (
            <div className="share-working mini">
              {t.shareConverting} {Math.round((playback.progress ?? 0) * 100)} %
            </div>
          )}
          {playback?.state === 'error' && (
            <div className="share-working mini">{t.shareVideoProblem}</div>
          )}
        </>
      ) : (
        <img
          key={item.id}
          className={`share-shot${rot}`}
          src={api.fileUrl(item.id)}
          alt={item.filename}
          draggable={false}
        />
      )}

      <div className="viewer-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} title={t.cancel} aria-label={t.cancel}>
          <IconX />
        </button>
        <button onClick={() => go(-1)} aria-label="←">
          <IconLeft />
        </button>
        <button onClick={() => go(1)} aria-label="→">
          <IconRight />
        </button>

        <div className="viewer-meta">
          <span className="n">{item.filename}</span>
          <span className="mini">
            {index + 1} / {items.length} · {formatDateTime(item.takenAt, lang)}
            {item.place ? ` · ${item.place}` : ''}
            {item.bytes ? ` · ${formatBytes(item.bytes)}` : ''}
          </span>
        </div>

        {allowDownload && (
          <button onClick={() => onDownload(item.id)} title={t.download}>
            <IconDownload />
          </button>
        )}
      </div>
    </div>
  );
}
