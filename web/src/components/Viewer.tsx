import { useEffect, useRef, useState } from 'react';
import type { MediaItem } from '../../../shared/types';
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    setHintVisible(true);
    const timer = setTimeout(() => setHintVisible(false), 2200);
    return () => clearTimeout(timer);
  }, [item.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play().catch(() => {});
    else video.pause();
  }, [playing, item.id]);

  return (
    <div className="viewer" onClick={onClose}>
      {item.kind === 'video' ? (
        <video
          ref={videoRef}
          src={api.fileUrl(item.id)}
          poster={api.thumbUrl(item.id, 960)}
          controls={playing}
          playsInline
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img src={api.fileUrl(item.id)} alt={item.filename} draggable={false} />
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
        </div>
      )}

      {item.kind === 'video' && !playing && (
        <div className="viewer-hint">{t.play}</div>
      )}

      {hintVisible && item.kind !== 'video' && (
        <div className="viewer-hint">← → · B / Esc</div>
      )}
    </div>
  );
}
