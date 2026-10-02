import { useCallback } from 'react';

import { useSettings } from '@/lib/hooks/useSettings';
import type { UserSettings } from '@/lib/storage';

import {
  useCollectionLibrary,
  type UseCollectionLibraryConfig,
  type UseCollectionLibraryReturn,
} from './use-collection-library';

/**
 * `useCollectionLibrary` behind a stored-credentials gate, for the platforms
 * whose readiness is `'credentials'` (github, youtube). `credentials` is the
 * platform's one resolver, exported from its Sync Adapter — the same function
 * the adapter's run gate and daily `probeReady` read, so the three can never
 * disagree on what "configured" means.
 *
 * `configured` drives the view's connect guide. Unconfigured, `sync` is a
 * silent no-op: no job starts and `syncing` never flips. While settings are
 * still loading they are `DEFAULT_SETTINGS`, which hold no credentials, so a
 * `sync()` in that window is silent too. The gate lives here, not in
 * `useCollectionLibrary`: the generic tier reads no storage.
 */
export function useCredentialGatedLibrary<TItem, TFacet, TProgress>(
  credentials: (settings: UserSettings) => string | object | null,
  config: UseCollectionLibraryConfig<TItem, TFacet, TProgress>,
): UseCollectionLibraryReturn<TItem, TFacet, TProgress> & {
  configured: boolean;
  settingsLoading: boolean;
} {
  const { settings, loading: settingsLoading } = useSettings();
  const configured = credentials(settings) !== null;
  const lib = useCollectionLibrary(config);
  const { sync: syncInner } = lib;

  const sync = useCallback(async () => {
    if (!configured) return;
    await syncInner();
  }, [configured, syncInner]);

  return { ...lib, sync, configured, settingsLoading };
}
