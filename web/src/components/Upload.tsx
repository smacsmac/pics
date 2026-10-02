import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { formatBytes } from '../lib/format';
import { useInput } from '../lib/input';
import { useStore } from '../lib/store';
import { IconAlbum, IconCheck, IconUpload, IconX } from './Icons';

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
  const { sheet, setSheet, state, refresh, t, toast, setOsk } = useStore();
  const open = sheet?.kind === 'upload';
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [picked, setPicked] = useState(0);
  const [progress, setProgress] = useState<Progress>(EMPTY);
  const [summary, setSummary] = useState<Progress | null>(null);
  /** Album de l'envoi qui vient de finir, pour le rappeler dans le bilan. */
  const [doneAlbum, setDoneAlbum] = useState<string | null>(null);
  // Album demandé pour cet envoi. Volontairement réduit à deux champs : on règle
  // la couleur, la musique et le reste plus tard, dans l'écran d'album.
  const [makeAlbum, setMakeAlbum] = useState(false);
  const [albumName, setAlbumName] = useState('');
  // Rangée visée à la manette : 0 = créer un album, 1 = le titre, 2 = choisir.
  const [focus, setFocus] = useState(0);
  const busy = phase !== 'idle';
  const album = makeAlbum ? albumName.trim() : '';

  const hasFolder = (state?.roots ?? []).some((r) => r.kind === 'import');
  const importRoot = (state?.roots ?? []).find((r) => r.kind === 'import');

  useEffect(() => {
    if (open) {
      setProgress(EMPTY);
      setSummary(null);
      setPhase('idle');
      setPicked(0);
      setMakeAlbum(false);
      setAlbumName('');
      setDoneAlbum(null);
      setFocus(0);
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
    async (files: File[], albumTarget: string) => {
      if (files.length === 0) {
        setPhase('idle');
        return;
      }
      setSummary(null);
      abort.current = new AbortController();

      // L'album est préparé avant le premier octet, avec la sélection entière :
      // les photos déjà reçues n'étant pas renvoyées, c'est le seul moment où
      // le serveur les voit passer et peut les y ranger.
      if (albumTarget) {
        try {
          await api.albumFromUpload(
            albumTarget,
            files.map((f) => ({ name: f.name, size: f.size })),
          );
        } catch {
          /* l'album échoue, l'envoi continue : les photos comptent plus que lui */
        }
      }

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
            albumTarget,
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
      setDoneAlbum(albumTarget || null);
      abort.current = null;
      await refresh();
      if (run.done > 0) toast(t.uploadDone(run.done));
    },
    [refresh, t, toast],
  );

  const pick = useCallback(() => {
    if (makeAlbum && albumName.trim() === '') {
      // Une case cochée sans titre créerait un album sans nom. On va chercher
      // le titre plutôt que de refuser en silence.
      setFocus(1);
      setOsk({ label: t.albumTitle, value: albumName, onCommit: setAlbumName });
      return;
    }
    inputRef.current?.click();
  }, [makeAlbum, albumName, setOsk, t.albumTitle]);

  /**
   * Les rangées atteignables à la manette. Le titre ne compte que si la case
   * est cochée : une rangée masquée mais comptée laisserait un cran mort sous
   * la croix directionnelle — on s'est déjà fait prendre ailleurs.
   */
  const rows = makeAlbum ? 3 : 2;
  const titleRow = 1;
  const pickRow = makeAlbum ? 2 : 1;

  useInput(
    useCallback(
      (action) => {
        if (!open) return false;
        if (busy) {
          // En plein envoi, seul B compte, et il annule — c'est le bouton
          // « Annuler » affiché à l'écran, pas une sortie discrète.
          if (action === 'back') abort.current?.abort();
          return true;
        }
        switch (action) {
          case 'back':
            setSheet(null);
            break;
          case 'up':
            setFocus((f) => Math.max(0, f - 1));
            break;
          case 'down':
            setFocus((f) => Math.min(rows - 1, f + 1));
            break;
          case 'confirm':
            if (focus === 0) {
              setMakeAlbum((on) => !on);
            } else if (focus === titleRow && makeAlbum) {
              setOsk({ label: t.albumTitle, value: albumName, onCommit: setAlbumName });
            } else if (focus === pickRow) {
              pick();
            }
            break;
          default:
            break;
        }
        return true;
      },
      [open, busy, setSheet, focus, rows, pickRow, makeAlbum, albumName, setOsk, t.albumTitle, pick],
    ),
    open,
  );

  // Décocher la case alors que le titre était visé laisserait le curseur sur une
  // rangée qui n'existe plus.
  useEffect(() => {
    setFocus((f) => Math.min(f, rows - 1));
  }, [rows]);

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

            {!busy && !summary && (
              <>
                <button
                  className={`panel-row${focus === 0 ? ' on' : ''}`}
                  style={{ textAlign: 'left' }}
                  onMouseEnter={() => setFocus(0)}
                  onClick={() => setMakeAlbum((on) => !on)}
                >
                  <div className="row-line">
                    <IconAlbum />
                    <span className="lab">{t.uploadMakeAlbum}</span>
                    <span className={`toggle${makeAlbum ? ' on' : ''}`}>
                      <span className="knob" />
                    </span>
                  </div>
                </button>

                {makeAlbum && (
                  <div
                    className={`field${focus === titleRow ? ' on' : ''}`}
                    onMouseEnter={() => setFocus(titleRow)}
                  >
                    <span className="lab">{t.albumTitle}</span>
                    <input
                      className="text-input"
                      value={albumName}
                      placeholder={t.albumTitle}
                      maxLength={120}
                      onChange={(e) => setAlbumName(e.target.value)}
                    />
                  </div>
                )}
              </>
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
                // Le titre est figé ici : le champ reste modifiable pendant
                // l'envoi sans que les photos partent dans deux albums.
                void send(files, album);
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
                {doneAlbum && (
                  <div className="option">
                    <IconAlbum />
                    <span className="n">{doneAlbum}</span>
                  </div>
                )}
              </div>
            )}

            {/* Les photos nouvelles rejoignent l'album quand le scan les a
                indexées, pas à la seconde où l'envoi finit. Le dire évite
                d'ouvrir un album à moitié vide en croyant à une panne. */}
            {doneAlbum && summary && summary.done > 0 && (
              <div className="mini">{t.uploadAlbumPending}</div>
            )}

            <div className="form-actions">
              {busy ? (
                <button className="btn danger" onClick={() => abort.current?.abort()}>
                  {t.cancel}
                </button>
              ) : (
                <>
                  <button className="btn" onClick={() => setSheet(null)}>{t.cancel}</button>
                  <button
                    className={`btn primary${focus === pickRow ? ' on' : ''}`}
                    onClick={pick}
                  >
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
