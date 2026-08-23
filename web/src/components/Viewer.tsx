import { useEffect, useRef, useState } from 'react';
import type { MediaItem, PlaybackInfo } from '../../../shared/types';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { formatDateTime } from '../lib/i18n';
import { useStore } from '../lib/store';

/**
 * Plein écran au sens propre : la photo occupe tout l'espace et rien d'autre
 * n'est affiché. Un rappel des touches s'efface au bout de deux secondes, et
 * les infos ne reviennent que si on les demande.
 */
export function Viewer({
  item,
  playing,
  showInfo,
  onClose,
}: {
  item: MediaItem;
  playing: boolean;
  showInfo: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const { settings, t } = useStore();
  const [hintVisible, setHintVisible] = useState(true);
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setHintVisible(true);
    const timer = setTimeout(() => setHintVisible(false), 2200);
    return () => clearTimeout(timer);
  }, [item.id]);

  /**
   * Une vidéo du téléphone est souvent en HEVC, que le navigateur ne décode
   * pas : on demande au serveur par quoi la lire. Tant que la copie H.264 se
   * prépare, on suit l'avancement plutôt que d'afficher une image figée.
   */
  useEffect(() => {
    setPlayback(null);
    if (item.kind !== 'video') return;
    let stop = false;
    let timer: number | undefined;

    const ask = async (): Promise<void> => {
      try {
        const info = await api.playback(item.id);
        if (stop) return;
        setPlayback(info);
        if (info.state === 'working') timer = window.setTimeout(() => void ask(), 1000);
      } catch {
        if (!stop) setPlayback({ direct: true, state: 'ready', progress: 1, url: api.fileUrl(item.id), vcodec: null });
      }
    };
    void ask();

    return () => {
      stop = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [item.id, item.kind]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => {});
    else video.pause();
  }, [playing, item.id, playback?.url]);

  return (
    <div className="viewer" onClick={onClose}>
      {item.kind === 'video' ? (
        <video
          ref={videoRef}
          // Sans URL on ne met rien : une balise vidéo pointée sur un fichier
          // que le navigateur ne sait pas décoder n'affiche qu'une image figée.
          src={playback?.url ?? undefined}
          poster={api.thumbUrl(item.id, 960, item.rotation)}
          controls={playing}
          playsInline
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        // La rotation est appliquée à l'affichage : le fichier d'origine n'est
        // jamais réécrit. À 90 et 270 degrés les bornes se croisent, sinon la
        // photo tournée déborderait de l'écran.
        <img
          className={item.rotation ? `rot rot${item.rotation}` : undefined}
          src={api.fileUrl(item.id)}
          alt={item.filename}
          draggable={false}
        />
      )}

      {showInfo && (
        <div className="viewer-info" onClick={(e) => e.stopPropagation()}>
          <div>{item.filename}</div>
          <div className="muted">{formatDateTime(item.takenAt, settings.lang)}</div>
          {item.place && <div className="muted">{item.place}</div>}
          {item.camera && <div className="muted">{item.camera}</div>}
          <div className="muted">
            {item.width && item.height ? `${item.width}×${item.height} · ` : ''}
            {formatBytes(item.bytes)}
          </div>
          {item.tags.length > 0 && <div className="muted">#{item.tags.join(' #')}</div>}
          {/* Hérités d'un album : ils comptent dans les recherches, mais se
              retirent sur l'album et non ici. D'où la mention. */}
          {item.albumTags.length > 0 && (
            <div className="muted">
              #{item.albumTags.join(' #')} <span className="from-album">· {t.fromAlbum}</span>
            </div>
          )}
        </div>
      )}

      {item.kind === 'video' && playback?.state === 'working' && (
        <div className="viewer-hint">
          {t.videoPreparing} {Math.round(playback.progress * 100)} %
        </div>
      )}

      {item.kind === 'video' && playback?.state === 'error' && (
        <div className="viewer-hint">{t.videoUnreadable}</div>
      )}

      {item.kind === 'video' && !playing && playback?.state === 'ready' && (
        <div className="viewer-hint">{t.play}</div>
      )}

      {hintVisible && item.kind !== 'video' && (
        <div className="viewer-hint">← → · B / Esc</div>
      )}
    </div>
  );
}
