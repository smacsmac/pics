import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem } from '../../../shared/types';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/i18n';
import { useInput, type Action } from '../lib/input';
import { SLIDE_SECONDS as SPEEDS } from '../lib/panels';
import { usePlayback } from '../lib/playback';
import { useStore } from '../lib/store';
import { IconLeft, IconPause, IconPlay, IconRight, IconX } from './Icons';

/** Durée de la fondu-enchaîné entre deux photos, en accord avec la feuille de style. */
const FADE_MS = 900;
/** Une vidéo qui refuse de se lire ne doit pas bloquer le défilement. */
const VIDEO_GIVE_UP_MS = 20_000;
/** Les commandes s'effacent après ce délai sans geste. */
const CONTROLS_MS = 2600;


/**
 * Mélange une liste sans la modifier. Le tirage est fait une seule fois au
 * démarrage : un ordre qui se retirerait à chaque photo ferait revenir les mêmes
 * images et en sauterait d'autres pour toujours.
 */
function shuffled<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Sens du léger mouvement de caméra, tiré de l'identifiant de la photo : deux
 * photos voisines ne dérivent pas du même côté, et une même photo dérive
 * toujours pareil, ce qui évite de sursauter en revenant en arrière.
 */
function drift(id: number): { x: number; y: number; from: number; to: number } {
  const angle = (id * 2.399963) % (Math.PI * 2);
  const zoomIn = id % 2 === 0;
  return {
    x: Math.cos(angle) * 2.6,
    y: Math.sin(angle) * 2.6,
    from: zoomIn ? 1.02 : 1.1,
    to: zoomIn ? 1.1 : 1.02,
  };
}

interface Props {
  /** Les photos à faire défiler, dans l'ordre. */
  items: MediaItem[];
  /** Photo de départ, dans cette même liste. */
  startIndex: number;
  title: string;
  /** Appelé quand on approche de la fin d'un flux paginé. */
  onNeedMore?: () => void;
  onClose: () => void;
  /** Signale la photo affichée, pour que la musique d'album s'atténue sur les vidéos. */
  onItem?: (item: MediaItem | undefined) => void;
}

export function Slideshow({
  items, startIndex, title, onNeedMore, onClose, onItem,
}: Props): React.JSX.Element | null {
  const { settings, patchSettings, t, toast } = useStore();
  const [cursor, setCursor] = useState(0);
  const [paused, setPaused] = useState(false);
  const [controls, setControls] = useState(true);
  // Photo précédente, gardée le temps du fondu : sans elle on verrait le fond
  // noir apparaître une fraction de seconde entre deux images.
  const [fading, setFading] = useState<MediaItem | null>(null);
  const idleTimer = useRef<number | null>(null);

  /**
   * L'ordre de passage. En aléatoire il est tiré une fois pour toutes ; sinon
   * c'est l'ordre de la liste. Il ne dépend que du nombre de photos, donc une
   * page qui arrive à la suite l'allonge sans rebrasser ce qui a déjà défilé.
   *
   * La photo demandée passe en tête du tirage : sans ça, partir d'une photo
   * précise en mode aléatoire ouvrait le diaporama sur « 6 / 8 », comme s'il
   * avait déjà tourné.
   */
  const order = useMemo(() => {
    const natural = items.map((_, i) => i);
    if (!settings.slideshowShuffle) return natural;
    const rest = shuffled(natural.filter((i) => i !== startIndex));
    return natural.includes(startIndex) ? [startIndex, ...rest] : rest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, settings.slideshowShuffle, startIndex]);

  // On démarre sur la photo demandée : depuis le plein écran, le diaporama
  // reprend là où on regardait plutôt que de tout recommencer.
  useEffect(() => {
    const at = order.indexOf(startIndex);
    setCursor(at >= 0 ? at : 0);
    // Seulement au montage : ensuite c'est le défilement qui commande.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const item = items[order[cursor] ?? 0];
  const nextItem = items[order[(cursor + 1) % order.length] ?? 0];
  const playback = usePlayback(item?.kind === 'video' ? item : undefined);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => onItem?.(item), [item, onItem]);

  const go = useCallback(
    (delta: number) => {
      setFading(item ?? null);
      setCursor((c) => {
        const n = order.length;
        if (n === 0) return 0;
        return ((c + delta) % n + n) % n;
      });
    },
    [item, order.length],
  );

  // Le fondu ne dure qu'un instant : on relâche l'ancienne photo derrière lui.
  useEffect(() => {
    if (!fading) return;
    const timer = window.setTimeout(() => setFading(null), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [fading]);

  // Le flux de la chronologie arrive page par page : on demande la suite bien
  // avant la fin, sinon le diaporama boucle sur les deux cents premières.
  useEffect(() => {
    if (onNeedMore && cursor >= order.length - 12) onNeedMore();
  }, [cursor, order.length, onNeedMore]);

  /**
   * Le minuteur du défilement. Une photo tient le nombre de secondes réglé ;
   * une vidéo va jusqu'au bout et prévient elle-même — avec un garde-fou, pour
   * qu'une vidéo illisible ne fige pas le diaporama pour de bon.
   */
  useEffect(() => {
    if (paused || !item) return;
    const wait =
      item.kind === 'video'
        ? Math.min(VIDEO_GIVE_UP_MS, Math.max(4000, (item.duration ?? 8) * 1000 + 1500))
        : settings.slideshowSeconds * 1000;
    const timer = window.setTimeout(() => go(1), wait);
    return () => window.clearTimeout(timer);
  }, [cursor, paused, item, settings.slideshowSeconds, go]);

  // Une vidéo se lance toute seule : dans un diaporama, personne n'appuie sur
  // « lire ». Le son reste celui du fichier ; la musique d'album s'efface.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => {});
  }, [paused, playback?.url]);

  const wake = useCallback(() => {
    setControls(true);
    if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => setControls(false), CONTROLS_MS);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current !== null) window.clearTimeout(idleTimer.current);
    };
  }, [wake]);

  const bumpSpeed = useCallback(
    (delta: number) => {
      const index = SPEEDS.indexOf(settings.slideshowSeconds);
      const next = Math.min(SPEEDS.length - 1, Math.max(0, (index < 0 ? 3 : index) + delta));
      patchSettings({ slideshowSeconds: SPEEDS[next] });
      toast(`${SPEEDS[next]} s`);
      wake();
    },
    [settings.slideshowSeconds, patchSettings, toast, wake],
  );

  /**
   * Le diaporama prend toutes les commandes tant qu'il est à l'écran : rien ne
   * doit atteindre la grille derrière lui. D'où le `true` final, qui absorbe
   * même les actions dont il ne fait rien.
   */
  const handle = useCallback(
    (action: Action): boolean => {
      wake();
      switch (action) {
        case 'back':
        case 'start':
          onClose();
          break;
        case 'confirm':
          setPaused((p) => !p);
          break;
        case 'left':
          go(-1);
          break;
        case 'right':
          go(1);
          break;
        case 'dec':
          bumpSpeed(-1);
          break;
        case 'inc':
          bumpSpeed(1);
          break;
        default:
          break;
      }
      return true;
    },
    [wake, onClose, go, bumpSpeed],
  );

  useInput(handle);

  if (!item) {
    return (
      <div className="slideshow" onClick={onClose}>
        <div className="slideshow-empty">{t.slideshowEmpty}</div>
      </div>
    );
  }

  const kb = drift(item.id);

  return (
    <div
      className="slideshow"
      onPointerMove={wake}
      onClick={() => {
        setPaused((p) => !p);
        wake();
      }}
    >
      {/* La photo qui s'en va reste sous la nouvelle le temps du fondu. */}
      {fading && fading.id !== item.id && (
        <img
          key={`out-${fading.id}`}
          className={`slide out${fading.rotation ? ` rot rot${fading.rotation}` : ''}`}
          src={api.fileUrl(fading.id)}
          alt=""
          draggable={false}
        />
      )}

      {item.kind === 'video' ? (
        <video
          key={item.id}
          ref={videoRef}
          className="slide"
          src={playback?.url ?? undefined}
          poster={api.thumbUrl(item.id, 960, item.rotation)}
          playsInline
          onEnded={() => go(1)}
          onClick={(e) => e.stopPropagation()}
          controls={paused}
        />
      ) : (
        <img
          key={item.id}
          className={`slide in${settings.slideshowPan ? ' pan' : ''}${item.rotation ? ` rot rot${item.rotation}` : ''}`}
          style={
            settings.slideshowPan
              ? ({
                  '--kb-x': `${kb.x}%`,
                  '--kb-y': `${kb.y}%`,
                  '--kb-from': String(kb.from),
                  '--kb-to': String(kb.to),
                  // Le mouvement dure toute la photo, fondu compris.
                  '--kb-dur': `${settings.slideshowSeconds + FADE_MS / 1000}s`,
                } as React.CSSProperties)
              : undefined
          }
          src={api.fileUrl(item.id)}
          alt={item.filename}
          draggable={false}
        />
      )}

      {/* Photo suivante chargée en avance : sans ça, chaque fondu commence par
          un écran noir pendant que le fichier arrive. */}
      {nextItem && nextItem.kind === 'photo' && nextItem.id !== item.id && (
        <link rel="preload" as="image" href={api.fileUrl(nextItem.id)} />
      )}

      {/* Le trait d'avancement bat la mesure : on voit venir le changement au
          lieu d'être surpris. Il repart de zéro à chaque photo. */}
      {!paused && item.kind === 'photo' && (
        <div className="slide-progress" key={`p-${cursor}`}>
          <i style={{ animationDuration: `${settings.slideshowSeconds}s` }} />
        </div>
      )}

      <div className={`slide-bar${controls ? '' : ' faded'}`} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} title={t.cancel} aria-label={t.cancel}>
          <IconX />
        </button>
        <button onClick={() => go(-1)} aria-label="←">
          <IconLeft />
        </button>
        <button
          className="big"
          onClick={() => setPaused((p) => !p)}
          title={paused ? t.playSlideshow : t.paused}
        >
          {paused ? <IconPlay /> : <IconPause />}
        </button>
        <button onClick={() => go(1)} aria-label="→">
          <IconRight />
        </button>

        <div className="slide-meta">
          <span className="n">{title}</span>
          <span className="muted">
            {cursor + 1} / {order.length} · {formatDateTime(item.takenAt, settings.lang)}
            {item.place ? ` · ${item.place}` : ''}
          </span>
        </div>

        <div className="slide-speed">
          <button onClick={() => bumpSpeed(-1)} disabled={settings.slideshowSeconds <= SPEEDS[0]}>
            −
          </button>
          <span>{settings.slideshowSeconds} s</span>
          <button
            onClick={() => bumpSpeed(1)}
            disabled={settings.slideshowSeconds >= SPEEDS[SPEEDS.length - 1]}
          >
            +
          </button>
        </div>
      </div>

      {paused && (
        <div className="slide-paused">
          <IconPause /> {t.paused}
        </div>
      )}

      {controls && <div className="slide-hint">{t.slideshowHint}</div>}
    </div>
  );
}
