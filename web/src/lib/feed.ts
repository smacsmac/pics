import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem, MediaQuery } from '../../../shared/types';
import { api } from './api';

const PAGE_SIZE = 200;

export interface Feed {
  items: MediaItem[];
  total: number;
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
  patchItems: (ids: number[], patch: Partial<MediaItem>) => void;
  dropItems: (ids: number[]) => void;
}

/**
 * Charge la chronologie page par page. La requête sert de clé : dès qu'un filtre
 * change, on repart de zéro plutôt que de mélanger deux jeux de résultats.
 */
export function useMediaFeed(query: MediaQuery, active = true): Feed {
  const key = JSON.stringify(query);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const requestId = useRef(0);

  useEffect(() => {
    if (!active) return;
    const id = ++requestId.current;
    setLoading(true);
    setItems([]);
    setCursor(null);
    setHasMore(true);

    api
      .media({ ...JSON.parse(key), limit: PAGE_SIZE })
      .then((page) => {
        if (id !== requestId.current) return; // une requête plus récente a pris la main
        setItems(page.items);
        setTotal(page.total);
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
      })
      .catch(() => {
        if (id === requestId.current) setHasMore(false);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [key, active, nonce]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore || cursor === null) return;
    const id = requestId.current;
    setLoading(true);
    api
      .media({ ...(JSON.parse(key) as MediaQuery), cursor, limit: PAGE_SIZE })
      .then((page) => {
        if (id !== requestId.current) return;
        setItems((prev) => {
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
        });
        setTotal(page.total);
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== null);
      })
      .catch(() => setHasMore(false))
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [cursor, hasMore, key, loading]);

  const patchItems = useCallback((ids: number[], patch: Partial<MediaItem>) => {
    const set = new Set(ids);
    setItems((prev) => prev.map((item) => (set.has(item.id) ? { ...item, ...patch } : item)));
  }, []);

  const dropItems = useCallback((ids: number[]) => {
    const set = new Set(ids);
    setItems((prev) => prev.filter((item) => !set.has(item.id)));
    setTotal((n) => Math.max(0, n - ids.length));
  }, []);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { items, total, loading, hasMore, loadMore, reload, patchItems, dropItems };
}

export interface DaySection {
  day: number; // minuit local
  items: MediaItem[];
}

/** Regroupe la chronologie par journée, la plus récente en premier. */
export function groupByDay(items: MediaItem[]): DaySection[] {
  const sections: DaySection[] = [];
  let current: DaySection | null = null;

  for (const item of items) {
    const d = new Date(item.takenAt);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (!current || current.day !== day) {
      current = { day, items: [] };
      sections.push(current);
    }
    current.items.push(item);
  }
  return sections;
}

export function useHistogram(query: MediaQuery, active = true): Array<{ month: number; count: number }> {
  const key = JSON.stringify({ ...query, to: undefined, cursor: undefined });
  const [buckets, setBuckets] = useState<Array<{ month: number; count: number }>>([]);

  useEffect(() => {
    if (!active) {
      setBuckets([]);
      return;
    }
    let cancelled = false;
    api
      .histogram(JSON.parse(key) as MediaQuery)
      .then((data) => {
        if (!cancelled) setBuckets(data);
      })
      .catch(() => {
        if (!cancelled) setBuckets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [key, active]);

  return useMemo(() => buckets, [buckets]);
}
