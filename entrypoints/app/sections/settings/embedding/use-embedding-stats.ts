import { useCallback, useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { getEmbeddingStats, type EmbeddingStats } from '@/lib/embedding';
import { onDomainEvent } from '@/lib/events';

const EVENT_REFRESH_DEBOUNCE_MS = 100;

export interface UseEmbeddingStatsReturn {
  stats: EmbeddingStats | null;
  /** Re-fetches and updates the stats (e.g. after a rebuild). */
  refresh: () => Promise<void>;
}

/**
 * Loads vector-index coverage stats on mount and exposes a manual refresh.
 */
export function useEmbeddingStats(): UseEmbeddingStatsReturn {
  const [stats, setStats] = useState<EmbeddingStats | null>(null);
  const [eventRevision, setEventRevision] = useState(0);

  // `initDbProxy()` is idempotent (joins main.tsx's in-flight init), so this
  // waits for DB readiness instead of racing `getDb()` on first paint.
  const fetchStats = useCallback(async (): Promise<EmbeddingStats | null> => {
    try {
      const db = await initDbProxy();
      return await getEmbeddingStats(db);
    } catch (err) {
      console.error('[settings] embedding stats load failed:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchStats().then((s) => {
      if (!cancelled && s) setStats(s);
    });
    return () => {
      cancelled = true;
    };
  }, [eventRevision, fetchStats]);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer != null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        setEventRevision((value) => value + 1);
      }, EVENT_REFRESH_DEBOUNCE_MS);
    };
    const unsubscribers = [
      onDomainEvent('item-content-updated', scheduleRefresh),
      onDomainEvent('item-embedded', scheduleRefresh),
    ];
    return () => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, []);

  const refresh = useCallback(async () => {
    const s = await fetchStats();
    if (s) setStats(s);
  }, [fetchStats]);

  return { stats, refresh };
}
