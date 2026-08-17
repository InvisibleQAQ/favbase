import { z } from 'zod';

import { MAX_HTML_BYTES, type FetchPageResult } from '@/lib/bookmarks/bookmark-page-fetch';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type {
  TranscribeResponse,
  TranscribeStatusPush,
} from '@/lib/transcription/types';
import type {
  SummaryResponse,
  SummaryResult,
  SummaryStatusPush,
} from '@/lib/summary/types';
import type { SyncResult } from '@/lib/sync/types';
import type { BgClientMessage, BgMessage } from './messages';
import {
  OFFSCREEN_PROTOCOL_CHANNEL,
  OFFSCREEN_PROTOCOL_VERSION,
} from '@/lib/offscreen/protocol';
import {
  MAX_RUNTIME_SUBTITLE_ROWS,
  runtimeEnvelopeShape,
  runtimeIdSchema,
  runtimeParamsSchema,
  runtimeSubtitleRowSchema,
  runtimeSubtitleSourceSchema,
  transcribeErrorSchema,
} from '@/lib/runtime-message/schemas';

export { MAX_RUNTIME_SUBTITLE_ROWS } from '@/lib/runtime-message/schemas';

export const BACKGROUND_PROTOCOL_CHANNEL = 'favbase-background';
export const BACKGROUND_PROTOCOL_VERSION = 1;

type BackgroundMessageType = BgMessage['type'];
type BackgroundMessageSchemaMap = {
  [Type in BackgroundMessageType]: z.ZodType<Extract<BgMessage, { type: Type }>>;
};

const envelopeShape = runtimeEnvelopeShape(
  BACKGROUND_PROTOCOL_CHANNEL,
  BACKGROUND_PROTOCOL_VERSION,
);
const offscreenProgressEnvelopeShape = {
  channel: z.union([
    z.literal(BACKGROUND_PROTOCOL_CHANNEL),
    z.literal(OFFSCREEN_PROTOCOL_CHANNEL),
  ]).optional(),
  protocolVersion: z.union([
    z.literal(BACKGROUND_PROTOCOL_VERSION),
    z.literal(OFFSCREEN_PROTOCOL_VERSION),
  ]).optional(),
};

const idSchema = runtimeIdSchema;
const platformSchema = z.string().min(1).max(64);
const subtitleRowSchema = runtimeSubtitleRowSchema;
const subtitleSourceSchema = runtimeSubtitleSourceSchema;
const paramsSchema = runtimeParamsSchema;

const transcribeResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: z.object({
      rows: z.array(subtitleRowSchema).max(MAX_RUNTIME_SUBTITLE_ROWS),
      source: subtitleSourceSchema,
      cached: z.boolean(),
    }),
  }),
  z.object({
    success: z.literal(false),
    error: transcribeErrorSchema,
  }),
]) satisfies z.ZodType<TranscribeResponse>;

const videoSegmentSchema = z.object({
  start: z.number().finite(),
  end: z.number().finite(),
  title: z.string().max(10_000),
  type: z.enum(['content', 'ad']),
});

const summaryResultSchema = z.object({
  markdown: z.string().max(5_000_000),
  segments: z.array(videoSegmentSchema).max(10_000),
  model: z.string().max(1_000),
  subtitleHash: z.string().max(10_000),
  createdAt: z.number().finite().nonnegative(),
}) satisfies z.ZodType<SummaryResult>;

const summaryErrorSchema = z.object({
  code: z.enum([
    'SUMMARY_NOT_CONFIGURED',
    'SUMMARY_NO_SUBTITLE',
    'SUMMARY_EMPTY_OUTPUT',
    'SUMMARY_ABORTED',
    'SUMMARY_DUPLICATE',
    'SUMMARY_REQUEST_FAILED',
  ]),
  message: z.string().max(50_000),
  params: paramsSchema.optional(),
});

const summaryResponseSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    data: summaryResultSchema.extend({ cached: z.boolean() }),
  }),
  z.object({
    success: z.literal(false),
    error: summaryErrorSchema,
  }),
]) satisfies z.ZodType<SummaryResponse>;

const webdavErrorCodeSchema = z.enum([
  'network',
  'auth',
  'locked',
  'permission',
  'invalid-settings',
  'incompatible-version',
  'unknown',
]);

const syncResultSchema = z.object({
  ok: z.boolean(),
  errorCode: webdavErrorCodeSchema.optional(),
  errorDetail: z.string().max(50_000).optional(),
}) satisfies z.ZodType<SyncResult>;

const fetchPageResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ok'), html: z.string().max(MAX_HTML_BYTES) }),
  z.object({
    kind: z.literal('permanent'),
    reason: z.enum(['invalid-url', 'http-4xx', 'not-html', 'too-large']),
  }),
  z.object({
    kind: z.literal('transient'),
    reason: z.enum(['http-5xx', 'http-429', 'timeout', 'network']),
  }),
]) satisfies z.ZodType<FetchPageResult>;

const backgroundMessageSchemas = {
  TRANSCRIBE_AUDIO: z.object({
    ...envelopeShape,
    type: z.literal('TRANSCRIBE_AUDIO'),
    platform: platformSchema,
    videoId: idSchema,
    cid: z.number().int().nonnegative().optional(),
    title: z.string().max(10_000),
  }),
  TRANSCRIBE_ABORT: z.object({
    ...envelopeShape,
    type: z.literal('TRANSCRIBE_ABORT'),
    videoId: idSchema,
  }),
  GET_VIDEO_CACHE: z.object({
    ...envelopeShape,
    type: z.literal('GET_VIDEO_CACHE'),
    platform: platformSchema,
    videoId: idSchema,
  }),
  CACHE_SUBTITLE: z.object({
    ...envelopeShape,
    type: z.literal('CACHE_SUBTITLE'),
    platform: platformSchema,
    videoId: idSchema,
    rows: z.array(subtitleRowSchema).max(MAX_RUNTIME_SUBTITLE_ROWS),
    source: subtitleSourceSchema,
  }),
  SUMMARIZE_VIDEO: z.object({
    ...envelopeShape,
    type: z.literal('SUMMARIZE_VIDEO'),
    platform: platformSchema,
    videoId: idSchema,
    title: z.string().max(10_000),
    force: z.boolean().optional(),
  }),
  SUMMARIZE_ABORT: z.object({
    ...envelopeShape,
    type: z.literal('SUMMARIZE_ABORT'),
    videoId: idSchema,
  }),
  GET_SUMMARY_CACHE: z.object({
    ...envelopeShape,
    type: z.literal('GET_SUMMARY_CACHE'),
    platform: platformSchema,
    videoId: idSchema,
  }),
  OPEN_APP_PAGE: z.object({
    ...envelopeShape,
    type: z.literal('OPEN_APP_PAGE'),
    hash: z.string().max(2_048).optional(),
  }),
  FETCH_BOOKMARK_PAGE: z.object({
    ...envelopeShape,
    type: z.literal('FETCH_BOOKMARK_PAGE'),
    url: z.string().min(1).max(8_192),
  }),
  WEBDAV_SYNC_NOW: z.object({
    ...envelopeShape,
    type: z.literal('WEBDAV_SYNC_NOW'),
  }),
  WEBDAV_CLEAR_REMOTE: z.object({
    ...envelopeShape,
    type: z.literal('WEBDAV_CLEAR_REMOTE'),
  }),
  OFFSCREEN_CHUNK_PROGRESS: z.object({
    ...offscreenProgressEnvelopeShape,
    type: z.literal('OFFSCREEN_CHUNK_PROGRESS'),
    sessionId: idSchema,
    chunkIndex: z.number().int().nonnegative(),
    totalChunks: z.number().int().positive(),
  }).refine((message) => message.chunkIndex < message.totalChunks),
} satisfies BackgroundMessageSchemaMap;

export const BACKGROUND_MESSAGE_TYPES = Object.freeze(
  Object.keys(backgroundMessageSchemas) as BackgroundMessageType[],
);

function backgroundMessageType(input: unknown): BackgroundMessageType | null {
  if (!input || typeof input !== 'object') return null;
  const type = (input as { type?: unknown }).type;
  if (typeof type !== 'string') return null;
  return Object.hasOwn(backgroundMessageSchemas, type)
    ? type as BackgroundMessageType
    : null;
}

export function decodeBackgroundMessage(input: unknown): BgMessage | null {
  const type = backgroundMessageType(input);
  if (!type) return null;
  const result = backgroundMessageSchemas[type].safeParse(input);
  return result.success ? result.data : null;
}

export type BackgroundResponseMap = {
  TRANSCRIBE_AUDIO: TranscribeResponse;
  TRANSCRIBE_ABORT: { success: true };
  GET_VIDEO_CACHE: { rows: SubtitleRow[]; source: SubtitleSource; cached: true } | null;
  CACHE_SUBTITLE: { success: boolean };
  SUMMARIZE_VIDEO: SummaryResponse;
  SUMMARIZE_ABORT: { success: true };
  GET_SUMMARY_CACHE: SummaryResult | null;
  OPEN_APP_PAGE: void;
  FETCH_BOOKMARK_PAGE: FetchPageResult;
  WEBDAV_SYNC_NOW: SyncResult;
  WEBDAV_CLEAR_REMOTE: SyncResult;
};

type BackgroundResponseSchemaMap = {
  [Type in keyof BackgroundResponseMap]: z.ZodType<BackgroundResponseMap[Type]>;
};

const backgroundResponseSchemas = {
  TRANSCRIBE_AUDIO: transcribeResponseSchema,
  TRANSCRIBE_ABORT: z.object({ success: z.literal(true) }),
  GET_VIDEO_CACHE: z.union([
    z.object({
      rows: z.array(subtitleRowSchema).max(MAX_RUNTIME_SUBTITLE_ROWS),
      source: subtitleSourceSchema,
      cached: z.literal(true),
    }),
    z.null(),
  ]),
  CACHE_SUBTITLE: z.object({ success: z.boolean() }),
  SUMMARIZE_VIDEO: summaryResponseSchema,
  SUMMARIZE_ABORT: z.object({ success: z.literal(true) }),
  GET_SUMMARY_CACHE: summaryResultSchema.nullable(),
  OPEN_APP_PAGE: z.undefined(),
  FETCH_BOOKMARK_PAGE: fetchPageResultSchema,
  WEBDAV_SYNC_NOW: syncResultSchema,
  WEBDAV_CLEAR_REMOTE: syncResultSchema,
} satisfies BackgroundResponseSchemaMap;

export type BackgroundClientMessageType = keyof BackgroundResponseMap;
export type BackgroundPushMessage = TranscribeStatusPush | SummaryStatusPush;

const backgroundPushSchemas = {
  TRANSCRIBE_STATUS: z.object({
    ...envelopeShape,
    type: z.literal('TRANSCRIBE_STATUS'),
    videoId: idSchema,
    progress: z.number().finite().min(0).max(100),
    stage: z.enum([
      'start',
      'subtitle_check',
      'connectivity',
      'extracting',
      'downloading',
      'uploading',
      'transcribing',
      'chunking',
      'chunk_transcribing',
      'processing',
      'done',
      'cancelled',
      'failed',
    ]),
    stageParams: paramsSchema.optional(),
    error: transcribeErrorSchema.optional(),
  }),
  SUMMARY_STATUS: z.object({
    ...envelopeShape,
    type: z.literal('SUMMARY_STATUS'),
    videoId: idSchema,
    markdown: z.string().max(5_000_000),
  }),
} satisfies {
  [Type in BackgroundPushMessage['type']]: z.ZodType<
    Extract<BackgroundPushMessage, { type: Type }>
  >;
};

type DecodeResult<T> = { ok: true; value: T } | { ok: false };

export function decodeBackgroundResponse<Type extends BackgroundClientMessageType>(
  type: Type,
  input: unknown,
): DecodeResult<BackgroundResponseMap[Type]> {
  const result = backgroundResponseSchemas[type].safeParse(input);
  return result.success
    ? { ok: true, value: result.data as BackgroundResponseMap[Type] }
    : { ok: false };
}

export function decodeBackgroundPush<Type extends BackgroundPushMessage['type']>(
  type: Type,
  input: unknown,
): Extract<BackgroundPushMessage, { type: Type }> | null {
  const result = backgroundPushSchemas[type].safeParse(input);
  return result.success
    ? result.data as Extract<BackgroundPushMessage, { type: Type }>
    : null;
}

export function encodeBackgroundPush(
  input: BackgroundPushMessage,
): BackgroundPushMessage & { channel: string; protocolVersion: number } | null {
  const decoded = decodeBackgroundPush(input.type, {
    ...input,
    channel: BACKGROUND_PROTOCOL_CHANNEL,
    protocolVersion: BACKGROUND_PROTOCOL_VERSION,
  });
  if (!decoded) return null;
  return {
    ...decoded,
    channel: BACKGROUND_PROTOCOL_CHANNEL,
    protocolVersion: BACKGROUND_PROTOCOL_VERSION,
  };
}

export type EncodedBackgroundMessage = BgMessage & {
  channel: string;
  protocolVersion: number;
};

export function encodeBackgroundMessage(input: BgMessage): EncodedBackgroundMessage | null {
  const message = decodeBackgroundMessage({
    ...input,
    channel: BACKGROUND_PROTOCOL_CHANNEL,
    protocolVersion: BACKGROUND_PROTOCOL_VERSION,
  });
  if (!message) return null;
  return {
    ...message,
    channel: BACKGROUND_PROTOCOL_CHANNEL,
    protocolVersion: BACKGROUND_PROTOCOL_VERSION,
  };
}

export function encodeBackgroundClientMessage(
  input: BgClientMessage,
): EncodedBackgroundMessage | null {
  const message = encodeBackgroundMessage(input);
  if (!message || message.type === 'OFFSCREEN_CHUNK_PROGRESS') return null;
  return message;
}
