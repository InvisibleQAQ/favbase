/**
 * Douyin's `AutoTranscribeAdapter` (docs/37 D5 / Step 3), the same shape as
 * `lib/bilibili/auto-transcribe-adapter.ts`: one transcription through the
 * shared app-side seam, the error mark, the two prerequisite answers and the
 * ASR quota guard. The ASR half is the shared storage helpers
 * (`lib/storage/asr-prerequisite.ts`); only the tab half is Douyin's.
 *
 * Three rulings this file carries (docs/37 Step 3 §0):
 * - A refused signature (`DOUYIN_SIGNATURE_REJECTED`) is a prerequisite, not a
 *   per-item error: the fix is the user reloading the tab, exactly like
 *   login / verification. Marking it 'error' would burn the whole backlog one
 *   signed request at a time, with no retry path in v1.
 * - While the user has to act on the tab (login / verify / signature),
 *   `transcribe()` short-circuits with the parked error: every later item
 *   bounces without a paced, signed request into the same wall, and the
 *   pipeline parks them all behind the one wait. A merely closed tab does NOT
 *   short-circuit — the Background handler's tab gate costs nothing, and a
 *   cache hit still succeeds without a tab (D7: no re-transcription).
 * - Three ways to wait: an ASR key → the shared settings watcher; a closed
 *   tab → poll `findDouyinTab()` every `VITE_DOUYIN_TAB_POLL_MS`; a user
 *   action on the tab → the next completed load of a douyin.com tab
 *   (`waitForDouyinTabLoad`), the cheapest evidence the user touched it.
 *
 * Legitimately imports `@/lib/storage` (as bilibili's does), so it is not in
 * the import-smoke list; the sync service and the SW handler never import it.
 */

import type { AutoTranscribeAdapter, TranscribePrerequisite } from '@/lib/auto-transcribe/types';
import { envNumber } from '@/lib/env';
import { sleep as sleepFor } from '@/lib/http/backoff';
import {
  getActiveAsrQuotaPause,
  hasAsrApiKey,
  setAsrQuotaPause,
  waitForAsrApiKey,
} from '@/lib/storage';
import {
  createStatusListener,
  transcribeAndPersist,
  type StartTranscribeProcessing,
} from '@/lib/transcription/transcribe-and-persist';
import type { TranscribeErrorInfo, TranscribeResponse } from '@/lib/transcription/types';
import { markDouyinError, persistDouyinTranscript } from './douyin-sync-service';
import { findDouyinTab, waitForDouyinTabLoad } from './douyin-tab';

/** How often a parked session re-checks for a usable douyin.com tab (docs/37 §4.5); only for a closed tab. */
const TAB_POLL_MS = envNumber('VITE_DOUYIN_TAB_POLL_MS', 5_000);
const PLATFORM = 'douyin';

export interface DouyinAutoTranscribeAdapterOptions {
  /** App-owned Embed / Tag lanes; the adapter never calls a provider itself. */
  startProcessing: StartTranscribeProcessing;
  /** Test seams; production uses douyin-tab.ts and lib/http/backoff. */
  findTab?: () => Promise<number | null>;
  waitForTabLoad?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

/** The user has to do something on the tab: sign in, pass a check, reload it. */
function needsUserAction(error: TranscribeErrorInfo): boolean {
  if (error.code === 'DOUYIN_SIGNATURE_REJECTED') return true;
  const reason = error.params?.reason;
  return error.code === 'DOUYIN_TAB_MISSING' && (reason === 'login' || reason === 'verify');
}

export function createDouyinAutoTranscribeAdapter(
  options: DouyinAutoTranscribeAdapterOptions,
): AutoTranscribeAdapter {
  const findTab = options.findTab ?? findDouyinTab;
  const waitForTabLoad = options.waitForTabLoad ?? waitForDouyinTabLoad;
  const sleep = options.sleep ?? sleepFor;
  /** The wall the session is parked behind while the user acts on the tab. */
  let awaitingUserAction: TranscribeErrorInfo | null = null;

  return {
    async transcribe(videoId: string, title: string, onIndexing?: () => void): Promise<TranscribeResponse> {
      if (awaitingUserAction) return { success: false, error: awaitingUserAction };
      return transcribeAndPersist({
        platform: PLATFORM,
        videoId,
        title,
        persist: persistDouyinTranscript,
        hooks: { onIndexing, startProcessing: options.startProcessing },
      });
    },

    markError: markDouyinError,

    async missingPrerequisite(error): Promise<TranscribePrerequisite | null> {
      if (error.code === 'ASR_INVALID_KEY') return (await hasAsrApiKey()) ? null : 'asr';
      if (needsUserAction(error)) return 'platform-tab';
      // T2 (docs/37 §4.3): judged NOW. The tab really gone parks the item;
      // the tab open and a request that merely failed is an ordinary failure
      // — parking it would resolve at once, re-queue, fail again, spin.
      if (error.code === 'DOUYIN_TAB_MISSING') return (await findTab()) === null ? 'platform-tab' : null;
      return null;
    },

    async waitForPrerequisite(error): Promise<void> {
      if (error.code === 'ASR_INVALID_KEY') {
        await waitForAsrApiKey();
        return;
      }
      if (needsUserAction(error)) {
        awaitingUserAction = error;
        try {
          await waitForTabLoad();
        } finally {
          awaitingUserAction = null;
        }
        return;
      }
      while ((await findTab()) === null) await sleep(TAB_POLL_MS);
    },

    getQuotaPause: getActiveAsrQuotaPause,

    setQuotaPause: setAsrQuotaPause,

    createStatusListener,
  };
}
