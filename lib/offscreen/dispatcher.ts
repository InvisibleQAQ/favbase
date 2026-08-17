import type { SubtitleRow } from '@/lib/subtitle/types';
import {
  createErrorInfo,
  type TranscribeErrorInfo,
} from '@/lib/transcription/types';
import { transcribeErrorSchema } from '@/lib/runtime-message/schemas';
import {
  decodeOffscreenRequest,
  type OffscreenResponseMap,
} from './protocol';
import type {
  OffscreenPrepareRequest,
  OffscreenStatus,
  OffscreenTranscribeRequest,
  SubsystemState,
} from './types';

export interface OffscreenMessageSender {
  id?: string;
}

export interface OffscreenDispatcherDependencies {
  getFfmpegState: () => SubsystemState;
  getPgliteState: () => SubsystemState;
  prepare: (request: OffscreenPrepareRequest) => Promise<void>;
  transcribe: (request: OffscreenTranscribeRequest) => Promise<SubtitleRow[]>;
  release: (sessionId: string) => void;
}

function normalizeError(error: unknown): TranscribeErrorInfo {
  const parsed = transcribeErrorSchema.safeParse(error);
  if (parsed.success) return parsed.data;
  return createErrorInfo(
    'ASR_UNKNOWN',
    error instanceof Error ? error.message : String(error),
  );
}

export function dispatchOffscreenMessage(
  input: unknown,
  sender: OffscreenMessageSender,
  sendResponse: (response?: unknown) => void,
  deps: OffscreenDispatcherDependencies,
): boolean {
  if (sender.id !== chrome.runtime.id) return false;

  const message = decodeOffscreenRequest(input);
  if (!message) return false;

  switch (message.type) {
    case 'OFFSCREEN_STATUS': {
      const response: OffscreenStatus = {
        ffmpeg: deps.getFfmpegState(),
        pglite: deps.getPgliteState(),
      };
      sendResponse(response);
      return false;
    }
    case 'OFFSCREEN_CHUNK_RELEASE':
      deps.release(message.sessionId);
      sendResponse({ success: true } satisfies OffscreenResponseMap['OFFSCREEN_CHUNK_RELEASE']);
      return false;
    case 'OFFSCREEN_CHUNK_PREPARE':
      deps.prepare(message).then(
        () => sendResponse({ success: true }),
        (error) => sendResponse({ success: false, error: normalizeError(error) }),
      );
      return true;
    case 'OFFSCREEN_CHUNK_TRANSCRIBE':
      deps.transcribe(message).then(
        (rows) => sendResponse({ success: true, rows }),
        (error) => sendResponse({ success: false, error: normalizeError(error) }),
      );
      return true;
  }

  return assertNever(message);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled offscreen message type: ${String(value)}`);
}
