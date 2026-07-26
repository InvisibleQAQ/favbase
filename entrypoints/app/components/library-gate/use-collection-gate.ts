import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';
import { useTranslation } from '@/lib/i18n/use-translation';

import { gatePlatformOf, useLibraryGate } from '../../hooks/library-gate';

/**
 * Gate view for one collection page: paused state + toggle actions + the
 * pre-translated hint the scaffold shows on the disabled fetch button.
 */
export interface CollectionGate {
  paused: boolean;
  pause: () => void;
  resume: () => void;
  /** Pre-translated tooltip for the fetch button while the gate is paused. */
  fetchBlockedHint: string;
}

/**
 * Resolve a scaffold's loose `platform: string` (job namespace or DB
 * discriminator) into a live gate subscription. Returns null for strings that
 * are not a gated collection platform (e.g. test fixtures) — the caller then
 * renders no gate UI and applies no gate disabling.
 */
export function useCollectionGate(platform: string): CollectionGate | null {
  const { t } = useTranslation();
  const gatePlatform = gatePlatformOf(platform);
  // Hooks are unconditional: subscribe with a fallback platform, then discard
  // the state when the input was not a real collection platform.
  const state = useLibraryGate(gatePlatform ?? COLLECTION_PLATFORMS[0]);
  if (gatePlatform == null) return null;
  return { ...state, fetchBlockedHint: t('pipeline.fetchBlockedByPause') };
}
