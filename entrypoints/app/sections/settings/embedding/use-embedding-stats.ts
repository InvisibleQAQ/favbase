import { useCallback, useEffect, useState } from 'react';

import { initDbProxy } from '@/lib/database';
import { getEmbeddingStats, type EmbeddingStats } from '@/lib/embedding';

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
  }, [fetchStats]);

  const refresh = useCallback(async () => {
    const s = await fetchStats();
    if (s) setStats(s);
  }, [fetchStats]);

  return { stats, refresh };
}
