import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getCollectionItems,
  isCollectionPlatform,
  type CollectionItem,
  type CollectionPlatform,
} from '@/lib/collections';
import { initDbProxy } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';

const PAGE_SIZE = 24;
const SEARCH_DEBOUNCE_MS = 300;

export interface UseCollectionsReturn {
  items: CollectionItem[];
  total: number;
  totalPages: number;
  loading: boolean;
  queryError: string | null;
  retryQuery: () => void;
  platform: CollectionPlatform | null;
  setPlatform: (platform: CollectionPlatform | null) => void;
  searchInput: string;
  setSearchInput: (value: string) => void;
  hasActiveFilter: boolean;
  page: number;
  goToPage: (page: number) => void;
}

/** Read-only state adapter for the globally sorted cross-platform library. */
export function useCollections(): UseCollectionsReturn {
  const [items, setItems] = useState<CollectionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [platform, setPlatformState] = useState<CollectionPlatform | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [queryVersion, setQueryVersion] = useState(0);

  const searchRef = useRef('');
  useEffect(() => {
    const id = setTimeout(() => {
      const next = searchInput.trim();
      if (next === searchRef.current) return;
      searchRef.current = next;
      setSearch(next);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchInput]);

  const setPlatform = useCallback((next: CollectionPlatform | null) => {
    setPlatformState(next);
    setPage(1);
  }, []);
  const goToPage = useCallback((next: number) => setPage(next), []);
  const retryQuery = useCallback(() => setQueryVersion((version) => version + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setQueryError(null);

    (async () => {
      try {
        await initDbProxy();
        const result = await getCollectionItems({ platform, search, page, pageSize: PAGE_SIZE });
        if (cancelled) return;
        setItems(result.rows);
        setTotal(result.total);
      } catch (err) {
        if (cancelled) return;
        setQueryError(err instanceof Error ? err.message : 'Query failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platform, search, page, queryVersion]);

  useEffect(
    () =>
      onDomainEvent('item-tagged', (event) => {
        if (isCollectionPlatform(event.platform)) retryQuery();
      }),
    [retryQuery],
  );

  return {
    items,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    loading,
    queryError,
    retryQuery,
    platform,
    setPlatform,
    searchInput,
    setSearchInput,
    hasActiveFilter: platform !== null || search !== '',
    page,
    goToPage,
  };
}
