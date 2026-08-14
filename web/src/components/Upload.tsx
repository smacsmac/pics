import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useInput } from '../lib/input';
import { useStore } from '../lib/store';
import { IconCheck, IconUpload, IconX } from './Icons';

interface Progress {
  total: number;
  done: number;
  skipped: number;
  failed: number;
  currentName: string;
  currentRatio: number;
  bytesSent: number;
  bytesTotal: number;
}

const EMPTY: Progress = {
  total: 0, done: 0, skipped: 0, failed: 0,
  currentName: '', currentRatio: 0, bytesSent: 0, bytesTotal: 0,
};

/**
 * « preparing » couvre le moment entre la fermeture du sélecteur de photos et
 * le premier octet envoyé : le temps d'interroger le serveur sur ce qu'il
 * connaît déjà. Sur une sélection de plusieurs centaines de photos ce délai se
 * voit, et sans rien à l'écran on croit que l'appui sur « Terminé » n'a pas
 * marché — on quitte, et tout le travail est perdu.
 */
type Phase = 'idle' | 'preparing' | 'sending';

/**
 * Envoi de photos depuis n'importe quel appareil du réseau local.
 *
 * Le navigateur ne donne accès à la pellicule que via un sélecteur, et
 * seulement sur geste de l'utilisateur : il n'existe pas de moyen de lire
 * automatiquement un dossier du téléphone. En échange, on rend le geste unique
 * — tout sélectionner à chaque fois — en écartant côté serveur ce qui est déjà
 * connu, pour ne transférer que le nouveau.
 */
export function UploadSheet(): React.JSX.Element | null {
  const { sheet, setSheet, state, refresh, t, toast } = useStore();
  const open = sheet?.kind === 'upload';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [picked, setPicked] = useState(0);
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [summary, setSummary] = useState<Progress | null>(null);
  const busy = phase !== 'idle';

  const hasFolder = (state?.roots ?? []).some((r) => r.kind === 'import');
  const importRoot = (state?.roots ?? []).find((r) => r.kind === 'import');

  useEffect(() => {
    if (open) {
      setProgress(EMPTY);
      setSummary(null);
      setPhase('idle');
      setPicked(0);
    }
  }, [open]);

  // Fermer l'onglet en plein envoi perd tout ce qui n'est pas encore parti.
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent): void => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  const send = useCallback(
    async (files: File[]) => {
      if (files.length === 0) {
        setPhase('idle');
        return;
      }
      setSummary(null);
      abort.current = new AbortController();

      // On demande d'abord ce que le serveur connaît déjà : inutile de faire
      // remonter par le Wi-Fi une photo qu'il a rangée le mois dernier.
      let known: boolean[] = [];
      try {
        const check = await api.uploadCheck(files.map((f) => ({ name: f.name, size: f.size })));
        known = check.known;
      } catch {
        known = [];
      }

      const todo = files.filter((_, i) => known[i] !== true);
      const run: Progress = {
        ...EMPTY,
        total: files.length,
        skipped: files.length - todo.length,
        bytesTotal: todo.reduce((sum, f) => sum + f.size, 0),
      };
      setProgress(run);
      setPhase('sending');

      for (const file of todo) {
        if (abort.current?.signal.aborted) break;
        run.currentName = file.name;
        run.currentRatio = 0;
        setProgress({ ...run });
        try {
          const result = await api.uploadFile(
            file,
            (ratio) => {
              run.currentRatio = ratio;
              setProgress({ ...run });
            },
            abort.current?.signal,
          );
          if (result.outcome === 'stored') run.done++;
          else if (result.outcome === 'duplicate') run.skipped++;
          else run.failed++;
        } catch (err) {
          if (err instanceof ApiError && err.code === 'aborted') break;
          run.failed++;
        }
        run.bytesSent += file.size;
        run.currentRatio = 0;
        setProgress({ ...run });
      }

      setPhase('idle');
      setSummary({ ...run, currentName: '' });
      abort.current = null;
      await refresh();
      if (run.done > 0) toast(t.uploadDone(run.done));
    },
    [refresh, t, toast],
  );

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (action === 'back' && !busy) setSheet(null);
        if (action === 'confirm' && !busy) inputRef.current?.click();
        return true;
      },
      [open, busy, setSheet],
    ),
    open,
  );

  if (!open) return null;

  const overall =
    progress.bytesTotal > 0
      ? Math.min(1, progress.bytesSent / progress.bytesTotal)
      : 0;

  return (
    <div className="overlay" onClick={() => !busy && setSheet(null)}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-title">{t.uploadTitle}</div>

        {!hasFolder ? (
          <>
            <div className="mini">{t.uploadNoFolder}</div>
            <div className="form-actions">
              <button className="btn" onClick={() => setSheet(null)}>{t.cancel}</button>
              <button className="btn primary" onClick={() => setSheet({ kind: 'folders' })}>
                {t.folders}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mini">{t.uploadHint}</div>
            {importRoot && (
              <div className="mini" style={{ wordBreak: 'break-all' }}>{importRoot.path}</div>
            )}

            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                // Affiché avant tout travail : l'utilisateur doit voir que son
                // « Terminé » a été pris en compte, sans attendre le réseau.
                setPicked(files.length);
                setPhase(files.length > 0 ? 'preparing' : 'idle');
                void send(files);
              }}
            />

            {phase === 'preparing' && (
              <div className="upload-progress">
                <div className="prep">
                  <span className="spin" />
                  <span>{t.uploadPreparing(picked)}</span>
                </div>
                <div className="mini">{t.uploadStay}</div>
              </div>
            )}

            {phase === 'sending' && (
              <div className="upload-progress">
                <div className="mini">
                  {progress.done + progress.skipped + progress.failed + 1} / {progress.total}
                  {' · '}
                  {progress.currentName}
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.round(progress.currentRatio * 100)}%` }} />
                </div>
                <div className="mini">
                  {formatBytes(progress.bytesSent)} / {formatBytes(progress.bytesTotal)}
                  {overall > 0 && ` · ${Math.round(overall * 100)} %`}
                </div>
                <div className="mini">{t.uploadStay}</div>
              </div>
            )}

            {summary && !busy && (
              <div className="option-list">
                <div className="option">
                  <IconCheck />
                  <span className="n">{t.uploadStored}</span>
                  <span className="c">{summary.done}</span>
                </div>
                <div className="option">
                  <IconX />
                  <span className="n">{t.uploadSkipped}</span>
                  <span className="c">{summary.skipped}</span>
                </div>
                {summary.failed > 0 && (
                  <div className="option" style={{ color: '#ff9aad' }}>
                    <span className="n">{t.uploadFailed}</span>
                    <span className="c">{summary.failed}</span>
                  </div>
                )}
              </div>
            )}

            <div className="form-actions">
              {busy ? (
                <button className="btn danger" onClick={() => abort.current?.abort()}>
                  {t.cancel}
                </button>
              ) : (
                <>
                  <button className="btn" onClick={() => setSheet(null)}>{t.cancel}</button>
                  <button className="btn primary" onClick={() => inputRef.current?.click()}>
                    <IconUpload /> {t.uploadPick}
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
