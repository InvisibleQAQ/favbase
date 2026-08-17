import { z } from 'zod';

import type { SubtitleRow } from '@/lib/subtitle/types';
import type { TranscribeErrorInfo } from '@/lib/transcription/types';
import {
  MAX_RUNTIME_SUBTITLE_ROWS,
  runtimeEnvelopeShape,
  runtimeIdSchema,
  runtimeSubtitleRowSchema,
  transcribeErrorSchema,
} from '@/lib/runtime-message/schemas';
import type {
  OffscreenPrepareRequest,
  OffscreenProgressMessage,
  OffscreenReleaseRequest,
  OffscreenRequest,
  OffscreenStatus,
  OffscreenStatusRequest,
  OffscreenTranscribeRequest,
} from './types';

export const OFFSCREEN_PROTOCOL_CHANNEL = 'favbase-offscreen';
export const OFFSCREEN_PROTOCOL_VERSION = 1;

const envelopeShape = runtimeEnvelopeShape(
  OFFSCREEN_PROTOCOL_CHANNEL,
  OFFSCREEN_PROTOCOL_VERSION,
);

type OffscreenRequestType = OffscreenRequest['type'];
type OffscreenRequestSchemaMap = {
  [Type in OffscreenRequestType]: z.ZodType<Extract<OffscreenRequest, { type: Type }>>;
};

const requestSchemas = {
  OFFSCREEN_STATUS: z.object({
    ...envelopeShape,
    type: z.literal('OFFSCREEN_STATUS'),
  }),
  OFFSCREEN_CHUNK_PREPARE: z.object({
    ...envelopeShape,
    type: z.literal('OFFSCREEN_CHUNK_PREPARE'),
    sessionId: runtimeIdSchema,
    audioUrl: z.string().url().max(8_192),
    maxBytes: z.number().int().positive(),
  }),
  OFFSCREEN_CHUNK_TRANSCRIBE: z.object({
    ...envelopeShape,
    type: z.literal('OFFSCREEN_CHUNK_TRANSCRIBE'),
    sessionId: runtimeIdSchema,
    apiKey: z.string().min(1).max(10_000),
    model: z.string().min(1).max(1_000),
    title: z.string().max(10_000),
    baseUrl: z.string().url().max(8_192),
  }),
  OFFSCREEN_CHUNK_RELEASE: z.object({
    ...envelopeShape,
    type: z.literal('OFFSCREEN_CHUNK_RELEASE'),
    sessionId: runtimeIdSchema,
  }),
} satisfies OffscreenRequestSchemaMap;

const progressSchema = z.object({
  ...envelopeShape,
  type: z.literal('OFFSCREEN_CHUNK_PROGRESS'),
  sessionId: runtimeIdSchema,
  chunkIndex: z.number().int().nonnegative(),
  totalChunks: z.number().int().positive(),
}).refine((message) => message.chunkIndex < message.totalChunks);

function requestType(input: unknown): OffscreenRequestType | null {
  if (!input || typeof input !== 'object') return null;
  const type = (input as { type?: unknown }).type;
  if (typeof type !== 'string' || !Object.hasOwn(requestSchemas, type)) return null;
  return type as OffscreenRequestType;
}

export function decodeOffscreenRequest(input: unknown): OffscreenRequest | null {
  const type = requestType(input);
  if (!type) return null;
  const result = requestSchemas[type].safeParse(input);
  return result.success ? result.data : null;
}

export type OffscreenResponseMap = {
  OFFSCREEN_STATUS: OffscreenStatus;
  OFFSCREEN_CHUNK_PREPARE: { success: true } | { success: false; error: TranscribeErrorInfo };
  OFFSCREEN_CHUNK_TRANSCRIBE:
    | { success: true; rows: SubtitleRow[] }
    | { success: false; error: TranscribeErrorInfo };
  OFFSCREEN_CHUNK_RELEASE: { success: true };
};

type OffscreenResponseType = keyof OffscreenResponseMap;
type OffscreenResponseSchemaMap = {
  [Type in OffscreenResponseType]: z.ZodType<OffscreenResponseMap[Type]>;
};

const subsystemStateSchema = z.enum(['pending', 'ready', 'failed']);
const responseSchemas = {
  OFFSCREEN_STATUS: z.object({
    ffmpeg: subsystemStateSchema,
    pglite: subsystemStateSchema,
  }),
  OFFSCREEN_CHUNK_PREPARE: z.discriminatedUnion('success', [
    z.object({ success: z.literal(true) }),
    z.object({ success: z.literal(false), error: transcribeErrorSchema }),
  ]),
  OFFSCREEN_CHUNK_TRANSCRIBE: z.discriminatedUnion('success', [
    z.object({
      success: z.literal(true),
      rows: z.array(runtimeSubtitleRowSchema).max(MAX_RUNTIME_SUBTITLE_ROWS),
    }),
    z.object({ success: z.literal(false), error: transcribeErrorSchema }),
  ]),
  OFFSCREEN_CHUNK_RELEASE: z.object({ success: z.literal(true) }),
} satisfies OffscreenResponseSchemaMap;

type DecodeResult<T> = { ok: true; value: T } | { ok: false };

export function decodeOffscreenResponse<Type extends OffscreenResponseType>(
  type: Type,
  input: unknown,
): DecodeResult<OffscreenResponseMap[Type]> {
  const result = responseSchemas[type].safeParse(input);
  return result.success
    ? { ok: true, value: result.data as OffscreenResponseMap[Type] }
    : { ok: false };
}

export function encodeOffscreenRequest(
  input: OffscreenRequest,
): OffscreenRequest & { channel: string; protocolVersion: number } | null {
  const message = decodeOffscreenRequest({
    ...input,
    channel: OFFSCREEN_PROTOCOL_CHANNEL,
    protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
  });
  if (!message) return null;
  return {
    ...message,
    channel: OFFSCREEN_PROTOCOL_CHANNEL,
    protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
  };
}

export function encodeOffscreenProgress(
  input: OffscreenProgressMessage,
): OffscreenProgressMessage & { channel: string; protocolVersion: number } | null {
  const result = progressSchema.safeParse({
    ...input,
    channel: OFFSCREEN_PROTOCOL_CHANNEL,
    protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
  });
  return result.success
    ? {
        ...result.data,
        channel: OFFSCREEN_PROTOCOL_CHANNEL,
        protocolVersion: OFFSCREEN_PROTOCOL_VERSION,
      }
    : null;
}
