import type { CooperativeCheckpoint } from '@/lib/collections';
import { syncStars } from '@/lib/github/github-sync-service';
import { settingsStorage } from '@/lib/storage';

import { runPlatformSync } from '../../hooks/platform-sync';
import type { AutoSyncPolicy } from '../../hooks/use-daily-auto-sync';

const ITEM_PLATFORM = 'github';

/** Phase 1: paged star-list fetch (determinate once the Link header lands). */
export interface StarsPhaseProgress {
  phase: 'stars';
  page: number;
  totalPages: number;
  fetchedCount: number;
  /** totalPages × average page size — exact once the last page lands. */
  estimatedTotal: number;
}

/** Phase 2: serial README fetch for new + ghost repos (diffed against the DB). */
export interface ReadmePhaseProgress {
  phase: 'readme';
  done: number;
  total: number;
  fetchedCount: number;
}

export type SyncProgress = StarsPhaseProgress | ReadmePhaseProgress;

/**
 * The github platform Sync Adapter — the single implementation of what a
 * github sync means: token resolution, then the two-phase domain sync with
 * typed progress run through the Platform Sync funnel (attempt record +
 * post-sync embed/tag dispatch). Both the manual collection page
 * (`useCollectionLibrary` syncFn) and the daily auto-sync coordinator run this
 * exact function; trigger policy (the UI token gate, the daily readiness
 * probe) stays with the callers. No token is a silent no-op that records
 * nothing — it never reaches the funnel.
 */
export async function runGithubStarsSync(
  onProgress: (progress: SyncProgress) => void,
  control: CooperativeCheckpoint,
): Promise<void> {
  const token = (await settingsStorage.getValue()).githubToken;
  if (!token) return;
  let fetchedTotal = 0;
  onProgress({
    phase: 'stars',
    page: 0,
    totalPages: 0,
    fetchedCount: 0,
    estimatedTotal: 0,
  });
  // The funnel records the attempt, then auto-tags + auto-embeds the READMEs
  // just persisted as background jobs. That dispatch lives app-side (not in
  // lib/github) — the tagging/embedding import chains need chrome.storage,
  // and lib/github stays storage-free.
  await runPlatformSync(ITEM_PLATFORM, control, async () => {
    const result = await syncStars(
      token,
      (page, totalPages, fetchedCount) => {
        fetchedTotal = fetchedCount;
        onProgress({
          phase: 'stars',
          page,
          totalPages,
          fetchedCount,
          estimatedTotal: Math.round((fetchedCount / page) * totalPages),
        });
      },
      (done, total) => {
        onProgress({ phase: 'readme', done, total, fetchedCount: fetchedTotal });
      },
      control,
    );
    return { fetched: result.total, inserted: result.inserted, newItemIds: result.newItemIds };
  });
}

/** Daily auto-sync trigger policy: a stored token means worth attempting. */
export const githubAutoSyncPolicy: AutoSyncPolicy = {
  probeReady: async () => Boolean((await settingsStorage.getValue()).githubToken),
};
