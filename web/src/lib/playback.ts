import { useEffect, useState } from 'react';
import type { MediaItem, PlaybackInfo } from '../../../shared/types';
import { api } from './api';

/**
 * Par quoi lire cette vidéo ? Les téléphones filment en HEVC, que les
 * navigateurs ne décodent pas : le serveur prépare alors une copie H.264 et on
 * suit son avancement. Utilisé par le plein écran comme par le diaporama, qui
 * doivent tous deux attendre la même réponse.
 */
export function usePlayback(item: MediaItem | undefined): PlaybackInfo | null {
  const [playback, setPlayback] = useState<PlaybackInfo | null>(null);
  const id = item?.id;
  const kind = item?.kind;

  useEffect(() => {
    setPlayback(null);
    if (kind !== 'video' || id === undefined) return;
    let stop = false;
    let timer: number | undefined;

    const ask = async (): Promise<void> => {
      try {
        const info = await api.playback(id);
        if (stop) return;
        setPlayback(info);
        if (info.state === 'working') timer = window.setTimeout(() => void ask(), 1000);
      } catch {
        // Le serveur n'a pas répondu : on tente le fichier d'origine plutôt que
        // de rester sur une image figée.
        if (!stop) {
          setPlayback({ direct: true, state: 'ready', progress: 1, url: api.fileUrl(id), vcodec: null });
        }
      }
    };
    void ask();

    return () => {
      stop = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [id, kind]);

  return playback;
}
