import { useCallback, useEffect, useRef, useState } from 'react';

import {
  COLLECTION_PLATFORMS,
  getCollectionAnalytics,
  type CollectionAnalyticsSnapshot,
  type CollectionPlatform,
} from '@/lib/collections';
import { initDbProxy } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';

export interface UseCollectionAnalyticsReturn {
  snapshot: CollectionAnalyticsSnapshot | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
  selectedPlatform: CollectionPlatform;
  selectPlatform: (platform: CollectionPlatform) => void;
}

export function selectInitialAnalyticsPlatform(
  snapshot: CollectionAnalyticsSnapshot,
): CollectionPlatform {
  return snapshot.platforms.reduce((selected, row) =>
    row.itemCount > selected.itemCount ? row : selected,
  ).platform;
}

export function useCollectionAnalytics(): UseCollectionAnalyticsReturn {
  const [snapshot, setSnapshot] = useState<CollectionAnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<CollectionPlatform>(
    COLLECTION_PLATFORMS[0],
  );
  const [queryVersion, setQueryVersion] = useState(0);
  const initializedSelection = useRef(false);
  const manuallySelected = useRef(false);

  const retry = useCallback(() => setQueryVersion((version) => version + 1), []);
  const selectPlatform = useCallback((platform: CollectionPlatform) => {
    manuallySelected.current = true;
    setSelectedPlatform(platform);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSnapshot(null);

    (async () => {
      try {
        await initDbProxy();
        const next = await getCollectionAnalytics();
        if (cancelled) return;
        setSnapshot(next);
        if (
          next.totalItems > 0 &&
          !initializedSelection.current &&
          !manuallySelected.current
        ) {
          setSelectedPlatform(selectInitialAnalyticsPlatform(next));
          initializedSelection.current = true;
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [queryVersion]);

  useEffect(() => onDomainEvent('item-tagged', retry), [retry]);

  return {
    snapshot,
    loading,
    error,
    retry,
    selectedPlatform,
    selectPlatform,
  };
}
