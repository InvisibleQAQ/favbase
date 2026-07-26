import { afterEach, describe, expect, it, vi } from 'vitest';

import { requestGroqTranscription } from './groq-client';

describe('requestGroqTranscription rate limits', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('classifies the Groq daily audio allowance as quota exhaustion', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        error: {
          message: 'Rate limit reached on audio seconds per day (ASD): Limit 28800, Used 28800.',
          type: 'rate_limit_exceeded',
        },
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '3600',
        },
      },
    )));

    await expect(requestGroqTranscription(
      new Blob(['audio'], { type: 'audio/mpeg' }),
      'groq-key',
      'whisper-large-v3-turbo',
    )).rejects.toMatchObject({
      code: 'ASR_QUOTA_EXCEEDED',
      providerId: 'groq',
      rateLimitKind: 'audio_seconds_per_day',
      retryAfter: 3600,
      resetAt: 4_600_000,
    });
  });

  it('keeps a request-window 429 as a temporary rate limit', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({
        error: {
          message: 'Rate limit reached on requests per minute (RPM).',
          type: 'rate_limit_exceeded',
        },
      }),
      {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': '17',
        },
      },
    )));

    const error = await requestGroqTranscription(
      new Blob(['audio'], { type: 'audio/mpeg' }),
      'groq-key',
      'whisper-large-v3-turbo',
    ).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'ASR_RATE_LIMIT',
      providerId: 'groq',
      retryAfter: 17,
      resetAt: 2_017_000,
    });
    expect(error).not.toHaveProperty('rateLimitKind');
  });

  it('does not claim daily quota exhaustion for an unknown 429 body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'not-json',
      {
        status: 429,
        headers: { 'retry-after': '9' },
      },
    )));

    const error = await requestGroqTranscription(
      new Blob(['audio'], { type: 'audio/mpeg' }),
      'groq-key',
      'whisper-large-v3-turbo',
    ).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: 'ASR_RATE_LIMIT',
      providerId: 'groq',
      retryAfter: 9,
    });
    expect(error).not.toHaveProperty('rateLimitKind');
  });
});
