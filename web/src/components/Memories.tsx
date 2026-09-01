import { useEffect, useRef } from 'react';
import type { Chapter, DuplicateGroup, Lang, MediaItem, OnThisDay } from '../../../shared/types';
import { api } from '../lib/api';
import type { Memories as MemoriesData } from '../lib/feed';
import { formatSpan, LOCALE } from '../lib/i18n';
import { useStore } from '../lib/store';
import { IconAlbum, IconCopies, IconPlay, IconSelect, IconSparkle } from './Icons';

/**
 * L'écran Souvenirs. Deux choses que l'application retrouve toute seule : ce
 * qui a été pris un même jour les années passées, et les « moments » — des
 * séries de photos prises coup sur coup au même endroit.
 *
 * Rien de tout cela n'est enregistré : les moments se recalculent, donc ils
 * suivent la bibliothèque. Celui qui mérite de rester devient un vrai album.
 */
export function MemoriesView({
  data,
  focusIndex,
  onFocus,
  onPlayDay,
  onPlayChapter,
  onMakeAlbum,
  onCols,
  onSortDuplicates,
}: {
  data: MemoriesData;
  /** Élément visé à la manette : les années d'abord, les moments ensuite. */
  focusIndex: number;
  onFocus: (index: number) => void;
  onPlayDay: (group: OnThisDay, startIndex: number) => void;
  onPlayChapter: (chapter: Chapter) => void;
  onMakeAlbum: (chapter: Chapter) => void;
  onCols: (n: number) => void;
  /** Sélectionne toute la série sauf la plus nette, prête à être cachée. */
  onSortDuplicates: (group: DuplicateGroup) => void;
}): React.JSX.Element {
  const { settings, t } = useStore();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const thisYear = new Date().getFullYear();

  // Les colonnes de la grille des moments décident du saut de ↑/↓.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = (): void => onCols(Math.max(1, Math.floor((el.clientWidth + 16) / 316)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onCols]);

  // Garde l'élément visé dans le champ de vision quand on navigue à la manette.
  useEffect(() => {
    if (focusIndex < 0) return;
    document
      .querySelector<HTMLElement>(`[data-memory="${focusIndex}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [focusIndex]);

  const days = data.onThisDay;

  return (
    <div className="memories">
      <section className="memory-section">
        <h2>
          <IconSparkle /> {t.onThisDay}
        </h2>

        {days.length === 0 ? (
          <p className="memory-hint">{t.onThisDayEmpty}</p>
        ) : (
          days.map((group, row) => (
            <div
              key={group.year}
              className={`day-strip${focusIndex === row ? ' on' : ''}`}
              data-memory={row}
              onMouseEnter={() => onFocus(row)}
            >
              <div className="day-strip-head">
                <span className="year">{group.year}</span>
                <span className="muted">{t.yearsAgo(thisYear - group.year)}</span>
                <span className="muted">· {t.photoCount(group.items.length)}</span>
                <button className="tiny-btn" onClick={() => onPlayDay(group, 0)}>
                  <IconPlay /> {t.playSlideshow}
                </button>
              </div>
              <div className="day-strip-rail">
                {group.items.map((item, i) => (
                  <Thumb key={item.id} item={item} onClick={() => onPlayDay(group, i)} />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <section className="memory-section">
        <h2>
          <IconSparkle /> {t.moments}
        </h2>
        <p className="memory-hint">{t.momentsHint}</p>

        <div className="moment-grid" ref={gridRef}>
          {data.chapters.length === 0 && !data.loading && (
            <p className="memory-hint">{t.noMoments}</p>
          )}

          {data.chapters.map((chapter, i) => {
            const index = days.length + i;
            return (
              <article
                key={chapter.id}
                className={`moment${focusIndex === index ? ' on' : ''}`}
                data-memory={index}
                onMouseEnter={() => onFocus(index)}
              >
                <button
                  className="moment-cover"
                  // La bande sous la couverture compte autant de colonnes qu'il
                  // y a de vignettes : un moment qui n'en fournit que trois
                  // remplit quand même la carte, sans trou à droite.
                  style={
                    { '--strip': String(Math.max(1, chapter.preview.length - 1)) } as React.CSSProperties
                  }
                  onClick={() => onPlayChapter(chapter)}
                  title={t.playSlideshow}
                >
                  {chapter.preview.map((p, k) => (
                    <img
                      key={p.id}
                      className={k === 0 ? 'big' : 'small'}
                      src={api.thumbUrl(p.id, k === 0 ? 480 : 240, p.rotation)}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  ))}
                  <span className="moment-play">
                    <IconPlay />
                  </span>
                </button>

                <div className="moment-body">
                  {/* Sans lieu connu, c'est la date qui fait le titre : mieux
                      vaut ça qu'un « sans lieu » répété sur toutes les cartes. */}
                  <span className="moment-title">
                    {chapter.city ?? chapterDay(chapter, settings.lang)}
                  </span>
                  <span className="muted">{formatSpan(chapter.from, chapter.to, settings.lang)}</span>
                  <span className="muted">{t.photoCount(chapter.count)}</span>
                </div>

                <div className="moment-actions">
                  <button className="tiny-btn" onClick={() => onPlayChapter(chapter)}>
                    <IconPlay /> {t.playSlideshow}
                  </button>
                  <button className="tiny-btn" onClick={() => onMakeAlbum(chapter)}>
                    <IconAlbum /> {t.makeAlbum}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* Le ménage. Ne s'affiche que s'il y a quelque chose à trier — une
          section vide sur toutes les bibliothèques bien rangées serait du
          bruit. */}
      {data.duplicates.length > 0 && (
        <section className="memory-section">
          <h2>
            <IconCopies /> {t.nearDuplicates}
          </h2>
          <p className="memory-hint">{t.nearDuplicatesHint}</p>

          <div className="dup-list">
            {data.duplicates.map((group, i) => {
              const index = days.length + data.chapters.length + i;
              return (
              <div
                key={group.id}
                className={`dup-group${focusIndex === index ? ' on' : ''}`}
                data-memory={index}
                onMouseEnter={() => onFocus(index)}
              >
                <div className="dup-head">
                  <span className="n">{t.duplicateGroup(group.ids.length)}</span>
                  <span className="muted">{formatSpan(group.from, group.to, settings.lang)}</span>
                  <button className="tiny-btn" onClick={() => onSortDuplicates(group)}>
                    <IconSelect /> {t.keepBest}
                  </button>
                </div>
                <div className="dup-rail">
                  {group.ids.map((id) => (
                    <div key={id} className={`dup-thumb${id === group.bestId ? ' best' : ''}`}>
                      <img src={api.thumbUrl(id, 240)} alt="" loading="lazy" draggable={false} />
                      {id === group.bestId && <span className="badge-best">★</span>}
                    </div>
                  ))}
                </div>
              </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function Thumb({ item, onClick }: { item: MediaItem; onClick: () => void }): React.JSX.Element {
  return (
    <button className="day-thumb" onClick={onClick} title={item.filename}>
      <img
        src={api.thumbUrl(item.id, 240, item.rotation)}
        alt=""
        loading="lazy"
        draggable={false}
      />
      {item.kind === 'video' && <span className="badge-video" />}
    </button>
  );
}

/** Le jour d'un moment, en toutes lettres : « 12 juillet 2026 ». */
function chapterDay(chapter: Chapter, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALE[lang], {
    day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(chapter.from));
}

/**
 * Nom proposé pour l'album issu d'un moment : le lieu s'il est connu, sinon la
 * date. C'est ce qu'on aurait tapé soi-même, et il reste modifiable après coup.
 */
export function chapterName(chapter: Chapter, lang: Lang): string {
  const when = chapterDay(chapter, lang);
  return chapter.city ? `${chapter.city} — ${when}` : when;
}
