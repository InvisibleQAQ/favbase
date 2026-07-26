/**
 * Summary message handlers. Thin: all policy lives in `lib/summary`.
 *
 * The LLM call MUST run here — MV3 content-script fetches are subject to the
 * host page's CORS (bilibili.com), and extension host permissions have not
 * applied to content scripts since Chrome 85. The SW is the only context in a
 * video tab's reach that can talk to a provider endpoint.
 */

import type { BackgroundContext } from './types';
import type { MessageSender } from './transcription-utils';
import {
  createSummaryError,
  isSummaryError,
  loadCachedSummary,
  summarizeVideo,
  type GetSummaryCacheRequest,
  type SummarizeAbort,
  type SummarizeRequest,
  type SummaryResponse,
  type SummaryResult,
  type SummaryStatusPush,
} from '@/lib/summary';

export async function handleSummarize(
  msg: SummarizeRequest,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<SummaryResponse> {
  const { platform, videoId, title, force } = msg;
  const tabId = sender.tab?.id ?? 0;

  const controller = ctx.startSummary(tabId, videoId);
  if (!controller) {
    return {
      success: false,
      error: createSummaryError('SUMMARY_DUPLICATE', `Already summarizing ${videoId}`),
    };
  }

  try {
    const data = await summarizeVideo(
      { platform, videoId, title, force },
      {
        signal: controller.signal,
        onPartial: (markdown) => {
          const push: SummaryStatusPush = { type: 'SUMMARY_STATUS', videoId, markdown };
          ctx.sendToTab(tabId, push);
        },
      },
    );
    return { success: true, data };
  } catch (err) {
    if (isSummaryError(err)) return { success: false, error: err };
    const detail = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: createSummaryError('SUMMARY_REQUEST_FAILED', detail, { detail }),
    };
  } finally {
    ctx.finishSummary(tabId, controller);
  }
}

export function handleGetSummaryCache(
  msg: GetSummaryCacheRequest,
): Promise<SummaryResult | null> {
  return loadCachedSummary(msg.platform, msg.videoId);
}

export function handleSummarizeAbort(
  _msg: SummarizeAbort,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<{ success: true }> {
  const tabId = sender.tab?.id;
  if (tabId) ctx.abortSummary(tabId);
  return Promise.resolve({ success: true });
}
