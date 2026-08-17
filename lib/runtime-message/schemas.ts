import { z } from 'zod';

export const MAX_RUNTIME_SUBTITLE_ROWS = 20_000;
export const RUNTIME_ID_MAX_LENGTH = 512;
export const RUNTIME_TEXT_MAX_LENGTH = 10_000;

export const runtimeIdSchema = z.string().min(1).max(RUNTIME_ID_MAX_LENGTH);
export const runtimeSubtitleRowSchema = z.object({
  start: z.number().finite(),
  end: z.number().finite(),
  text: z.string().max(RUNTIME_TEXT_MAX_LENGTH),
});
export const runtimeSubtitleSourceSchema = z.enum(['official', 'asr']);
export const runtimeParamsSchema = z.record(
  z.string(),
  z.union([z.string().max(50_000), z.number().finite()]),
).refine((params) => Object.keys(params).length <= 100);

export const transcribeErrorSchema = z.object({
  code: z.enum([
    'ASR_REQUEST_TIMEOUT',
    'ASR_RATE_LIMIT',
    'ASR_QUOTA_EXCEEDED',
    'ASR_GROQ_UNREACHABLE',
    'ASR_GROQ_ACCESS_BLOCKED',
    'ASR_INVALID_KEY',
    'ASR_CHUNKING_FAILED',
    'ASR_CHUNKING_UNSUPPORTED',
    'ASR_CHUNK_DURATION_UNKNOWN',
    'ASR_AUDIO_REUSED',
    'ASR_NO_AUDIO_SOURCE',
    'DOWNLOAD_FAILED',
    'ASR_UNKNOWN',
    'TRANSCRIBE_DUPLICATE',
    'UNSUPPORTED_PLATFORM',
  ]),
  message: z.string().max(50_000),
  params: runtimeParamsSchema.optional(),
  retryAfter: z.number().finite().nonnegative().optional(),
  resetAt: z.number().finite().nonnegative().optional(),
  rateLimitKind: z.literal('audio_seconds_per_day').optional(),
  providerId: z.enum(['groq', 'siliconflow']).optional(),
});

export function runtimeEnvelopeShape(channel: string, version: number) {
  return {
    channel: z.literal(channel).optional(),
    protocolVersion: z.literal(version).optional(),
  };
}
