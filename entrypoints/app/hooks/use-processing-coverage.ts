import { useEffect, useState } from 'react';

import {
  EMPTY_PROCESSING_COVERAGE,
  getProcessingCoverage,
  type CollectionPlatform,
  type ProcessingCoverage,
} from '@/lib/collections';
import { initDbProxy } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';

import type { ProcessingCoverageStatus } from './pipeline-segments';

const EVENT_REFRESH_DEBOUNCE_MS = 100;

export type ProcessingCoverageRefreshKey = string | number | boolean | null | undefined;

export interface UseProcessingCoverageResult {
  coverage: ProcessingCoverage;
  status: ProcessingCoverageStatus;
  loading: boolean;
  error: string | null;
}

/**
 * Owns DB-backed idle coverage and event-driven refresh. Runtime progress stays
 * in platform adapters; this hook deliberately has no polling or platform branches.
 */
export function useProcessingCoverage(
  platform: CollectionPlatform,
  refreshKey?: ProcessingCoverageRefreshKey,
): UseProcessingCoverageResult {
  const [coverage, setCoverage] = useState<ProcessingCoverage>(EMPTY_PROCESSING_COVERAGE);
  const [status, setStatus] = useState<ProcessingCoverageStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [eventRevision, setEventRevision] = useState(0);

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshIfMatching = ({ platform: changedPlatform }: { platform: string }) => {
      if (changedPlatform !== platform || refreshTimer != null) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        setEventRevision((value) => value + 1);
      }, EVENT_REFRESH_DEBOUNCE_MS);
    };
    const unsubscribers = [
      onDomainEvent('item-content-updated', refreshIfMatching),
      onDomainEvent('item-embedded', refreshIfMatching),
      onDomainEvent('item-tagged', refreshIfMatching),
    ];
    return () => {
      if (refreshTimer != null) clearTimeout(refreshTimer);
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [platform]);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    void initDbProxy()
      .then((db) => getProcessingCoverage(platform, db))
      .then((snapshot) => {
        if (!cancelled) {
          setCoverage(snapshot);
          setStatus('ready');
        }
      })
      .catch((err: unknown) => {
        console.error(`[processing-coverage] ${platform} load failed:`, err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [platform, refreshKey, eventRevision]);

  return { coverage, status, loading: status === 'loading', error };
}
