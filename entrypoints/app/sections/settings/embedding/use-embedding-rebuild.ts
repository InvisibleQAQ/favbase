import { useCallback, useState } from 'react';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { UserSettings } from '@/lib/storage';
import type { EnsurePermissionResult } from '@/lib/permissions/host-access';
import { initDbProxy } from '@/lib/database';
import {
  rebuildPendingEmbeddings,
  resolveEmbeddingConfig,
  type RebuildOutcome,
  type RebuildProgress,
} from '@/lib/embedding';
import { permissionErrorKey } from '../permission-error';

export interface UseEmbeddingRebuildOptions {
  settings: UserSettings;
  /**
   * Host-permission gate from the card's single `useHostPermission()`
   * instance — its Dialog must stay unique, so the hook receives `ensure`
   * instead of creating its own.
   */
  ensure: (baseUrl: string) => Promise<EnsurePermissionResult>;
}

export interface UseEmbeddingRebuildReturn {
  isRebuilding: boolean;
  progress: RebuildProgress | null;
  outcome: RebuildOutcome | null;
  error: string | null;
  rebuild: () => Promise<void>;
}

/**
 * Manual rebuild: re-embed the 'chunked' backlog in this page's context.
 * It always runs against the SAVED config (what indexing actually uses),
 * never the unsaved draft. Failure stops the loop (finished items stay
 * 'embedded'), so clicking again resumes with only the remainder.
 */
export function useEmbeddingRebuild({
  settings,
  ensure,
}: UseEmbeddingRebuildOptions): UseEmbeddingRebuildReturn {
  const { t } = useTranslation();
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [progress, setProgress] = useState<RebuildProgress | null>(null);
  const [outcome, setOutcome] = useState<RebuildOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rebuild = useCallback(async () => {
    setIsRebuilding(true);
    setProgress(null);
    setOutcome(null);
    setError(null);

    try {
      const saved = resolveEmbeddingConfig(settings);
      // Not-configured is decidable locally (same `enabled` derivation the
      // rebuild uses internally) — bail out before popping a host-permission
      // dialog for a provider that cannot embed anything anyway.
      if (!saved.enabled) {
        setOutcome({ status: 'not-configured' });
        return;
      }
      // Same host-access gate as the test-connection button: verify or restore
      // the configured API origin before fetching from this page.
      const perm = await ensure(saved.baseUrl);
      if (!perm.ok) {
        setError(t(permissionErrorKey(perm.reason)));
        return;
      }
      const db = await initDbProxy();
      const result = await rebuildPendingEmbeddings(db, undefined, setProgress);
      setOutcome(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRebuilding(false);
    }
  }, [settings, ensure, t]);

  return { isRebuilding, progress, outcome, error, rebuild };
}
