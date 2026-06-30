import type { BackgroundContext } from './types';
import type {
  TranscribeRequest,
  TranscribeAbort,
  TranscribeResponse,
} from '@/lib/transcription/types';
import type { OffscreenProgressMessage } from '@/lib/offscreen/types';
import { createErrorInfo } from '@/lib/transcription/types';
import { PROGRESS } from '@/lib/transcription/constants';
import { handleBiliTranscribe } from '@/lib/bilibili/bilibili-transcription-handler';
import { notifyTab, type MessageSender } from './transcription-utils';

export type { MessageSender } from './transcription-utils';
export { notifyTab, createTranscribeAudio } from './transcription-utils';

export type PlatformHandler = (
  msg: TranscribeRequest,
  tabId: number,
  ctx: BackgroundContext,
  signal: AbortSignal,
) => Promise<TranscribeResponse>;

const platformHandlers: Record<string, PlatformHandler> = {
  bilibili: handleBiliTranscribe,
};

export async function handleTranscribe(
  msg: TranscribeRequest,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<TranscribeResponse> {
  const { videoId, platform } = msg;
  const tabId = sender.tab?.id ?? 0;

  const handler = platformHandlers[platform];
  if (!handler) {
    return {
      success: false,
      error: createErrorInfo('UNSUPPORTED_PLATFORM', `Unknown platform: ${platform}`),
    };
  }

  const controller = ctx.startTranscription(tabId, videoId);
  if (!controller) {
    return {
      success: false,
      error: createErrorInfo('TRANSCRIBE_DUPLICATE', `Already transcribing ${videoId}`),
    };
  }

  try {
    return await handler(msg, tabId, ctx, controller.signal);
  } finally {
    ctx.finishTranscription(tabId);
  }
}

export function handleTranscribeAbort(
  _msg: TranscribeAbort,
  sender: MessageSender,
  ctx: BackgroundContext,
): Promise<{ success: true }> {
  const tabId = sender.tab?.id;
  if (tabId) ctx.abortTranscription(tabId);
  return Promise.resolve({ success: true });
}

export function handleOffscreenProgress(
  msg: OffscreenProgressMessage,
  _sender: MessageSender,
  ctx: BackgroundContext,
): void {
  const range = PROGRESS.CHUNK_TRANSCRIBE_END - PROGRESS.CHUNK_TRANSCRIBE_BEGIN;
  const progress =
    PROGRESS.CHUNK_TRANSCRIBE_BEGIN +
    Math.round((msg.chunkIndex / msg.totalChunks) * range);
  const stageParams = { current: msg.chunkIndex + 1, total: msg.totalChunks };

  const target = ctx.resolveProgressTarget(msg.sessionId);
  if (!target) {
    console.warn(`[handleOffscreenProgress] unresolved sessionId=${msg.sessionId}, dropping progress`);
    return;
  }
  notifyTab(ctx, target.tabId, target.videoId, progress, 'chunk_transcribing', undefined, stageParams);
}
