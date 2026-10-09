import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TranscribeResponse } from '@/lib/transcription/types';
import { AutoTranscribePipeline } from './pipeline';
import type {
  AutoTranscribeAdapter,
  AutoTranscribeState,
  AutoTranscribeVideo,
} from './types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function video(videoId: string): AutoTranscribeVideo {
  return {
    videoId,
    title: videoId,
    cover: '',
    author: 'UP',
    duration: 60,
  };
}

function success(videoId = 'BV1'): TranscribeResponse {
  return {
    success: true,
    data: { videoId, rows: [], source: 'official', cached: false },
  };
}

function dailyQuotaExceeded(): TranscribeResponse {
  return {
    success: false,
    error: {
      code: 'ASR_QUOTA_EXCEEDED',
      message: 'Groq daily audio allowance exhausted',
      providerId: 'groq',
      retryAfter: 3600,
      resetAt: 4_600_000,
      rateLimitKind: 'audio_seconds_per_day',
    },
  };
}

function rateLimited(retryAfter: number): TranscribeResponse {
  return {
    success: false,
    error: {
      code: 'ASR_RATE_LIMIT',
      message: 'Temporary rate limit',
      retryAfter,
    },
  };
}

function makeAdapter(
  overrides: Partial<AutoTranscribeAdapter> = {},
): AutoTranscribeAdapter {
  return {
    transcribe: vi.fn(),
    markError: vi.fn().mockResolvedValue(undefined),
    missingPrerequisite: vi.fn().mockResolvedValue(null),
    waitForPrerequisite: vi.fn().mockResolvedValue(undefined),
    getQuotaPause: vi.fn().mockResolvedValue(null),
    setQuotaPause: vi.fn().mockResolvedValue(undefined),
    createStatusListener: vi.fn(() => () => undefined),
    ...overrides,
  };
}

function waitForState(
  pipeline: AutoTranscribePipeline,
  predicate: (state: AutoTranscribeState) => boolean,
): Promise<void> {
  if (predicate(pipeline.getSnapshot())) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = pipeline.subscribe(() => {
      if (!predicate(pipeline.getSnapshot())) return;
      unsubscribe();
      resolve();
    });
  });
}

function missingAsrConfiguration(): TranscribeResponse {
  return {
    success: false,
    error: {
      code: 'ASR_INVALID_KEY',
      message: 'ASR API key is not configured',
    },
  };
}

function unknownFailure(): TranscribeResponse {
  return {
    success: false,
    error: {
      code: 'ASR_UNKNOWN',
      message: 'transcription failed',
    },
  };
}

/** The adapter judgement a platform makes for a missing ASR key (lib/bilibili). */
const asrKeyMissing: AutoTranscribeAdapter['missingPrerequisite'] = async (error) =>
  error.code === 'ASR_INVALID_KEY' ? 'asr' : null;

function tabMissing(): TranscribeResponse {
  return {
    success: false,
    error: {
      code: 'DOUYIN_TAB_MISSING',
      message: 'no usable tab',
      params: { reason: 'closed' },
    },
  };
}

function platformRateLimited(retryAfter: number): TranscribeResponse {
  return {
    success: false,
    error: {
      code: 'DOUYIN_RATE_LIMITED',
      message: 'HTTP 403',
      retryAfter,
    },
  };
}

function asrSuccess(videoId = 'BV1'): TranscribeResponse {
  return {
    success: true,
    data: { videoId, rows: [], source: 'asr', cached: false },
  };
}

/** A daily quota whose reset lands a few seconds after the 60 s limit floor (tests start at t = 1 000). */
function shortQuota(): TranscribeResponse {
  const quota = dailyQuotaExceeded();
  if (!quota.success) quota.error.resetAt = 70_000;
  return quota;
}

/** `waitSeconds` at each entry into `'paused'` — the temporary-limit waits, in order. */
function recordPausedWaits(pipeline: AutoTranscribePipeline): number[] {
  const waits: number[] = [];
  let previous = pipeline.getSnapshot().phase;
  pipeline.subscribe(() => {
    const { phase, waitSeconds } = pipeline.getSnapshot();
    if (phase === 'paused' && previous !== 'paused') waits.push(waitSeconds);
    previous = phase;
  });
  return waits;
}

describe('AutoTranscribePipeline streaming session', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('appends later batches to one serial run and settles only after close and drain', async () => {
    vi.useFakeTimers();
    const first = deferred<TranscribeResponse>();
    const second = deferred<TranscribeResponse>();
    let active = 0;
    let maxActive = 0;
    const transcribe = vi.fn(async (videoId: string) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        return await (videoId === 'BV-1' ? first.promise : second.promise);
      } finally {
        active -= 1;
      }
    });
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      const run = session.run();

      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledWith('BV-1', 'BV-1', expect.any(Function)));
      session.append([video('BV-2')]);
      expect(pipeline.getSnapshot()).toMatchObject({ totalVideos: 2, currentIndex: 0 });

      first.resolve(success());
      await waitForState(
        pipeline,
        (state) => state.phase === 'waiting' && state.currentVideoId === 'BV-1',
      );
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));

      let settled = false;
      void run.then(() => { settled = true; });
      second.resolve(success());
      await waitForState(
        pipeline,
        (state) => state.phase === 'waiting' && state.currentVideoId === 'BV-2',
      );
      await vi.advanceTimersByTimeAsync(20_000);
      await Promise.resolve();
      expect(settled).toBe(false);

      session.close();
      await run;
      expect(maxActive).toBe(1);
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        totalVideos: 2,
        currentIndex: 2,
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('retains and retries the current item after missing ASR configuration is saved', async () => {
    vi.useFakeTimers();
    const configured = deferred<void>();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(missingAsrConfiguration())
      .mockResolvedValueOnce(success());
    const waitForPrerequisite = vi.fn(() => configured.promise);
    const checkpoint = vi.fn(async () => undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({
      transcribe,
      missingPrerequisite: asrKeyMissing,
      waitForPrerequisite,
    }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-NEEDS-ASR')]);
      session.close();
      const run = session.run({ checkpoint });

      await waitForState(pipeline, (state) => state.phase === 'configuration_required');
      expect(transcribe).toHaveBeenCalledOnce();
      // The wait is handed the error the item was parked on.
      expect(waitForPrerequisite).toHaveBeenCalledOnce();
      expect(waitForPrerequisite).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ASR_INVALID_KEY' }),
      );
      expect(pipeline.getSnapshot()).toMatchObject({
        prerequisiteBlocked: 'asr',
        currentVideoId: 'BV-NEEDS-ASR',
        currentIndex: 0,
        stats: { skipped: 0, remaining: 1 },
      });

      configured.resolve();
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      expect(checkpoint).toHaveBeenCalledTimes(3); // runner start, item claim, config resume
      await waitForState(pipeline, (state) => state.phase === 'waiting');
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        prerequisiteBlocked: null,
        currentIndex: 1,
        stats: { skipped: 0, remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('continues with later videos while one item waits for ASR configuration', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const configured = deferred<void>();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(missingAsrConfiguration())
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(success());
    const waitForAsrKey = vi.fn(() => configured.promise);
    const pipeline = new AutoTranscribePipeline(makeAdapter({
      transcribe,
      missingPrerequisite: asrKeyMissing,
      waitForPrerequisite: waitForAsrKey,
    }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-NEEDS-ASR'), video('BV-OFFICIAL')]);
      session.close();
      const run = session.run();

      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      expect(transcribe.mock.calls.map(([videoId]) => videoId)).toEqual([
        'BV-NEEDS-ASR',
        'BV-OFFICIAL',
      ]);
      expect(waitForAsrKey).toHaveBeenCalledOnce();
      expect(pipeline.getSnapshot()).toMatchObject({
        prerequisiteBlocked: 'asr',
        currentIndex: 1,
        stats: { remaining: 1 },
      });

      await vi.advanceTimersByTimeAsync(20_000);
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'configuration_required',
        prerequisiteBlocked: 'asr',
      });

      configured.resolve();
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3));
      expect(transcribe.mock.calls[2][0]).toBe('BV-NEEDS-ASR');
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        prerequisiteBlocked: null,
        currentIndex: 2,
        stats: { remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('shares one ASR configuration watcher across multiple parked items', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const configured = deferred<void>();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(missingAsrConfiguration())
      .mockResolvedValueOnce(missingAsrConfiguration())
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(success());
    const waitForAsrKey = vi.fn(() => configured.promise);
    const pipeline = new AutoTranscribePipeline(makeAdapter({
      transcribe,
      missingPrerequisite: asrKeyMissing,
      waitForPrerequisite: waitForAsrKey,
    }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-ASR-1'), video('BV-ASR-2')]);
      session.close();
      const run = session.run();

      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      expect(transcribe.mock.calls.map(([videoId]) => videoId)).toEqual([
        'BV-ASR-1',
        'BV-ASR-2',
      ]);
      expect(waitForAsrKey).toHaveBeenCalledOnce();
      expect(pipeline.getSnapshot()).toMatchObject({
        prerequisiteBlocked: 'asr',
        currentIndex: 0,
        stats: { remaining: 2 },
      });

      configured.resolve();
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3));
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(4));
      expect(transcribe.mock.calls.map(([videoId]) => videoId)).toEqual([
        'BV-ASR-1',
        'BV-ASR-2',
        'BV-ASR-1',
        'BV-ASR-2',
      ]);
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        prerequisiteBlocked: null,
        currentIndex: 2,
        stats: { remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it("parks an item on a 'platform-tab' prerequisite and re-queues it in order once the adapter says the tab is back", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const tabBack = deferred<void>();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(tabMissing())
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(success());
    const waitForPrerequisite = vi.fn(() => tabBack.promise);
    const checkpoint = vi.fn(async () => undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({
      transcribe,
      // What the Douyin adapter answers when the tab really is gone (docs/37 D5).
      missingPrerequisite: async (error) =>
        error.code === 'DOUYIN_TAB_MISSING' ? 'platform-tab' : null,
      waitForPrerequisite,
    }));

    try {
      const session = pipeline.createSession();
      session.append([video('DY-1'), video('DY-2')]);
      session.close();
      const run = session.run({ checkpoint });

      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      expect(waitForPrerequisite).toHaveBeenCalledOnce();
      expect(waitForPrerequisite).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'DOUYIN_TAB_MISSING' }),
      );
      expect(pipeline.getSnapshot()).toMatchObject({
        prerequisiteBlocked: 'platform-tab',
        stats: { skipped: 0, remaining: 1 },
      });
      await vi.advanceTimersByTimeAsync(20_000);
      expect(pipeline.getSnapshot()).toMatchObject({ phase: 'configuration_required' });
      const checkpointsBeforeResume = checkpoint.mock.calls.length;

      tabBack.resolve();
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3));
      // The parked item comes back in its original place, through a checkpoint.
      expect(transcribe.mock.calls.map(([videoId]) => videoId)).toEqual(['DY-1', 'DY-2', 'DY-1']);
      expect(checkpoint.mock.calls.length).toBe(checkpointsBeforeResume + 1);
      expect(pipeline.getSnapshot().prerequisiteBlocked).toBeNull();
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        prerequisiteBlocked: null,
        currentIndex: 2,
        stats: { skipped: 0, remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  // docs/38: a temporary rate limit (a `retryAfter`, judged after prerequisite
  // and quota) never fails the item. The item stays current and is retried
  // after max(retryAfter, min(600, 60·2^(k-1))) seconds, k = consecutive
  // temporary limits in this session; any other outcome resets k.
  it('retries the same item through three consecutive temporary limits with a doubling floor, then counts it once', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transcribe = vi.fn()
      .mockResolvedValueOnce(rateLimited(2))
      .mockResolvedValueOnce(rateLimited(2))
      .mockResolvedValueOnce(rateLimited(2))
      .mockResolvedValueOnce(asrSuccess());
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));
    const waits = recordPausedWaits(pipeline);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run();

      await waitForState(pipeline, () => waits.length === 1);
      expect(waits).toEqual([60]);
      // The countdown and the sleep agree: nothing is resent a millisecond early.
      await vi.advanceTimersByTimeAsync(59_999);
      expect(transcribe).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await waitForState(pipeline, () => waits.length === 2);
      expect(transcribe).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(120_000);
      await waitForState(pipeline, () => waits.length === 3);
      expect(transcribe).toHaveBeenCalledTimes(3);

      await vi.advanceTimersByTimeAsync(240_000);
      await waitForState(pipeline, (state) => state.phase === 'waiting');
      expect(transcribe).toHaveBeenCalledTimes(4);
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(waits).toEqual([60, 120, 240]);
      expect(transcribe.mock.calls.map(([videoId]) => videoId)).toEqual(['BV-1', 'BV-1', 'BV-1', 'BV-1']);
      expect(markError).not.toHaveBeenCalled();
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        currentIndex: 1,
        stats: { asr: 1, skipped: 0, remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('caps the backoff floor at 600 s from the fifth consecutive temporary limit on', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transcribe = vi.fn();
    for (let i = 0; i < 6; i += 1) transcribe.mockResolvedValueOnce(rateLimited(2));
    transcribe.mockResolvedValueOnce(asrSuccess());
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));
    const waits = recordPausedWaits(pipeline);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run();
      await vi.runAllTimersAsync();
      await run;

      expect(waits).toEqual([60, 120, 240, 480, 600, 600]);
      expect(transcribe).toHaveBeenCalledTimes(7);
      expect(markError).not.toHaveBeenCalled();
      expect(pipeline.getSnapshot()).toMatchObject({ phase: 'done', stats: { asr: 1, skipped: 0 } });
    } finally {
      pipeline.dispose();
    }
  });

  it("waits the limit's own retryAfter when it is longer than the floor (a platform cooldown of 1800 s), judged by shape", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transcribe = vi.fn()
      .mockResolvedValueOnce(platformRateLimited(1_800))
      .mockResolvedValueOnce(platformRateLimited(1_800))
      .mockResolvedValueOnce(asrSuccess('DY-1'));
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));
    const waits = recordPausedWaits(pipeline);

    try {
      const session = pipeline.createSession();
      session.append([video('DY-1')]);
      session.close();
      const run = session.run();

      await waitForState(pipeline, () => waits.length === 1);
      await vi.advanceTimersByTimeAsync(1_799_999);
      expect(transcribe).toHaveBeenCalledTimes(1);
      await vi.runAllTimersAsync();
      await run;

      expect(waits).toEqual([1_800, 1_800]);
      expect(transcribe).toHaveBeenCalledTimes(3);
      expect(markError).not.toHaveBeenCalled();
      expect(pipeline.getSnapshot()).toMatchObject({ phase: 'done', stats: { asr: 1, skipped: 0 } });
    } finally {
      pipeline.dispose();
    }
  });

  // Each row: per-item scripts, and the floor the second item's limit must get.
  // Without the reset, B's first limit would be the k-th consecutive one.
  it.each([
    {
      outcome: 'a success',
      scripts: { A: [rateLimited(2), rateLimited(2), asrSuccess('A')], B: [rateLimited(2), asrSuccess('B')] },
      waits: [60, 120, 60],
      markedErrors: [] as string[],
    },
    {
      outcome: 'an ordinary failure',
      scripts: { A: [rateLimited(2), unknownFailure()], B: [rateLimited(2), asrSuccess('B')] },
      waits: [60, 60],
      markedErrors: ['A'],
    },
    {
      outcome: 'a rejected transcription',
      scripts: { A: [rateLimited(2), new Error('message bridge failed')], B: [rateLimited(2), asrSuccess('B')] },
      waits: [60, 60],
      markedErrors: ['A'],
    },
    {
      outcome: 'a daily quota pause',
      scripts: { A: [rateLimited(2), shortQuota(), rateLimited(2), asrSuccess('A')], B: [asrSuccess('B')] },
      waits: [60, 60],
      markedErrors: [] as string[],
    },
    {
      outcome: 'a parked prerequisite',
      scripts: { A: [rateLimited(2), tabMissing(), asrSuccess('A')], B: [rateLimited(2), asrSuccess('B')] },
      waits: [60, 60],
      markedErrors: [] as string[],
    },
  ])('resets the backoff after $outcome: the next temporary limit waits max(retryAfter, 60) again', async ({ scripts, waits: expected, markedErrors }) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const remaining: Record<string, Array<TranscribeResponse | Error>> = {
      A: [...scripts.A],
      B: [...scripts.B],
    };
    const transcribe = vi.fn(async (videoId: string) => {
      const next = remaining[videoId]?.shift();
      if (!next) throw new Error(`script exhausted for ${videoId}`);
      if (next instanceof Error) throw next;
      return next;
    });
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({
      transcribe,
      markError,
      missingPrerequisite: async (error) => (error.code === 'DOUYIN_TAB_MISSING' ? 'platform-tab' : null),
      // Far enough out that B runs first; runAllTimersAsync reaches it.
      waitForPrerequisite: () => new Promise<void>((resolve) => { setTimeout(resolve, 1_000_000); }),
    }));
    const waits = recordPausedWaits(pipeline);

    try {
      const session = pipeline.createSession();
      session.append([video('A'), video('B')]);
      session.close();
      const run = session.run();
      await vi.runAllTimersAsync();
      await run;

      expect(waits).toEqual(expected);
      expect(markError.mock.calls.map(([videoId]) => videoId)).toEqual(markedErrors);
      expect(remaining).toEqual({ A: [], B: [] });
      expect(pipeline.getSnapshot()).toMatchObject({ phase: 'done', stats: { remaining: 0 } });
    } finally {
      pipeline.dispose();
    }
  });

  it('stop() during a temporary-limit wait cancels the session without marking the item', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn().mockResolvedValue(rateLimited(2));
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run();
      await waitForState(pipeline, (state) => state.phase === 'paused');
      await vi.advanceTimersByTimeAsync(30_000);

      pipeline.stop();
      await run;

      expect(pipeline.getSnapshot().phase).toBe('cancelled');
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(markError).not.toHaveBeenCalled();
    } finally {
      pipeline.dispose();
    }
  });

  it('judges a daily quota before the retryAfter shape: a quota response pauses, it is not retried as a rate limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const quota = dailyQuotaExceeded();
    if (!quota.success) quota.error.resetAt = 5_000;
    const transcribe = vi.fn()
      .mockResolvedValueOnce(quota)
      .mockResolvedValue(success());
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run();

      await waitForState(pipeline, (state) => state.phase === 'quota_paused');
      expect(pipeline.getSnapshot()).toMatchObject({ phase: 'quota_paused', quotaResetAt: 5_000 });
      expect(transcribe).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(4_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(20_000);
      await run;
      expect(pipeline.getSnapshot()).toMatchObject({ phase: 'done', stats: { skipped: 0 } });
    } finally {
      pipeline.dispose();
    }
  });

  it('marks an ordinary item failure and continues draining the session', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(unknownFailure())
      .mockResolvedValueOnce(success());
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-FAIL'), video('BV-NEXT')]);
      session.close();
      const run = session.run();
      await waitForState(pipeline, (state) => state.phase === 'waiting');
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(markError).toHaveBeenCalledWith('BV-FAIL');
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        currentIndex: 2,
        stats: { skipped: 1, remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('contains a rejected item transcription and continues with the next item', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn()
      .mockRejectedValueOnce(new Error('message bridge failed'))
      .mockResolvedValueOnce(success());
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-THROW'), video('BV-NEXT')]);
      session.close();
      const run = session.run();
      await waitForState(pipeline, (state) => state.phase === 'waiting');
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(markError).toHaveBeenCalledWith('BV-THROW');
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        stats: { skipped: 1, remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });
});

describe('AutoTranscribePipeline session controls', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks a born-paused gate before reading quota state or claiming a video', async () => {
    const parked = deferred<void>();
    const release = deferred<void>();
    const getQuotaPause = vi.fn().mockResolvedValue(null);
    const transcribe = vi.fn().mockResolvedValue(success());
    const pipeline = new AutoTranscribePipeline(makeAdapter({ getQuotaPause, transcribe }));
    const control = {
      checkpoint: vi.fn(async () => {
        parked.resolve();
        await release.promise;
      }),
    };

    try {
      const session = pipeline.createSession();
      session.append([video('BV-PAUSED')]);
      session.close();
      const run = session.run(control);

      await parked.promise;
      expect(getQuotaPause).not.toHaveBeenCalled();
      expect(transcribe).not.toHaveBeenCalled();
      expect(pipeline.getSnapshot()).toMatchObject({
        currentVideoId: '',
        stats: { remaining: 1 },
      });

      release.resolve();
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      pipeline.dispose();
      await run;
    } finally {
      pipeline.dispose();
    }
  });

  it('retains the current and later videos until the daily quota resets', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const quota = dailyQuotaExceeded();
    if (!quota.success) quota.error.resetAt = 5_000;
    const transcribe = vi.fn()
      .mockResolvedValueOnce(quota)
      .mockResolvedValue(success());
    const setQuotaPause = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      transcribe,
      setQuotaPause,
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1'), video('BV-2')]);
      session.close();
      const run = session.run();

      await vi.waitFor(() => {
        expect(pipeline.getSnapshot().phase).toBe('quota_paused');
      });

      expect(transcribe).toHaveBeenCalledOnce();
      expect(setQuotaPause).toHaveBeenCalledWith({ providerId: 'groq', resetAt: 5_000 });
      expect(pipeline.getSnapshot()).toMatchObject({
        quotaResetAt: 5_000,
        stats: { skipped: 0, remaining: 2 },
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3));
      await vi.advanceTimersByTimeAsync(5_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        currentIndex: 2,
        stats: { skipped: 0, remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('pauses when the retry response reports daily quota exhaustion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const transcribe = vi.fn()
      .mockResolvedValueOnce(rateLimited(1))
      .mockResolvedValueOnce(dailyQuotaExceeded());
    const setQuotaPause = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({ transcribe, setQuotaPause });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1'), video('BV-2')]);
      session.close();
      void session.run();
      await waitForState(pipeline, (state) => state.phase === 'paused');
      // A temporary limit waits at least the 60 s backoff floor (docs/38).
      await vi.advanceTimersByTimeAsync(60_000);

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'quota_paused',
        quotaResetAt: 4_600_000,
        stats: { skipped: 0, remaining: 2 },
      });
      expect(transcribe).toHaveBeenCalledTimes(2);
      expect(setQuotaPause).toHaveBeenCalledWith({ providerId: 'groq', resetAt: 4_600_000 });
    } finally {
      pipeline.dispose();
    }
  });

  it('retains streaming items behind a durable quota guard and resumes after reset', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transcribe = vi.fn().mockResolvedValue(success());
    const setQuotaPause = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      transcribe,
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 5_000 }),
      setQuotaPause,
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      const run = session.run();
      await waitForState(pipeline, (state) => state.phase === 'quota_paused');

      session.append([video('BV-2')]);
      session.close();
      let settled = false;
      void run.then(() => { settled = true; });

      expect(transcribe).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'quota_paused',
        quotaResetAt: 5_000,
        stats: { remaining: 2 },
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(1));
      expect(setQuotaPause).toHaveBeenCalledWith(null);

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(5_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        currentIndex: 2,
        stats: { remaining: 0 },
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('blocks before claiming the next video when the cooperative checkpoint pauses', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn().mockResolvedValue(success());
    const adapter = makeAdapter({ transcribe });
    const pipeline = new AutoTranscribePipeline(adapter);

    let paused = false;
    const parked = deferred<void>();
    let release: (() => void) | null = null;
    const control = {
      checkpoint: async () => {
        if (!paused) return;
        parked.resolve();
        await new Promise<void>((resolve) => {
          release = () => {
            paused = false;
            resolve();
          };
        });
      },
    };

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1'), video('BV-2')]);
      session.close();
      const run = session.run(control);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      paused = true; // pause request lands while BV-1's post-item wait runs
      await vi.advanceTimersByTimeAsync(20_000);
      await parked.promise; // worker parked at the next-video checkpoint

      expect(transcribe).toHaveBeenCalledOnce(); // BV-2 not claimed while paused

      release!();
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
      await vi.advanceTimersByTimeAsync(20_000);
      await run;
      expect(transcribe).toHaveBeenCalledTimes(2);
    } finally {
      pipeline.dispose();
    }
  });

  it('passes the cooperative checkpoint after a temporary-limit wait, before the item is resent', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const transcribe = vi.fn()
      .mockResolvedValueOnce(rateLimited(2))
      .mockResolvedValueOnce(asrSuccess());
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe }));
    let paused = false;
    const parked = deferred<void>();
    const release = deferred<void>();
    const checkpoint = vi.fn(async () => {
      if (!paused) return;
      parked.resolve();
      await release.promise;
    });

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run({ checkpoint });
      await waitForState(pipeline, (state) => state.phase === 'paused');
      const checkpointsBeforeWait = checkpoint.mock.calls.length;
      paused = true; // the Library Gate pauses while the limit's wait runs

      await vi.advanceTimersByTimeAsync(60_000);
      expect(transcribe).toHaveBeenCalledTimes(1); // nothing resent while paused
      await parked.promise;
      expect(checkpoint).toHaveBeenCalledTimes(checkpointsBeforeWait + 1);

      paused = false;
      release.resolve();
      await waitForState(pipeline, (state) => state.phase === 'waiting');
      expect(transcribe).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(20_000);
      await run;
    } finally {
      pipeline.dispose();
    }
  });

  // A Library Gate pause can hold the post-wait checkpoint for as long as the
  // user likes; a stop() pressed meanwhile must not let the item be resent
  // (and then marked) once the gate opens.
  it.each([
    { wait: 'a temporary-limit wait', first: () => rateLimited(2), waitMs: 60_000 },
    { wait: 'a daily quota wait', first: shortQuota, waitMs: 69_000 },
  ])('stop() while the checkpoint after $wait holds cancels without resending or marking the item', async ({ first, waitMs }) => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const transcribe = vi.fn()
      .mockResolvedValueOnce(first())
      .mockResolvedValue(unknownFailure());
    const markError = vi.fn().mockResolvedValue(undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe, markError }));
    let paused = false;
    const parked = deferred<void>();
    const release = deferred<void>();
    const checkpoint = vi.fn(async () => {
      if (!paused) return;
      parked.resolve();
      await release.promise;
    });

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run({ checkpoint });
      await waitForState(pipeline, (state) => state.phase === 'paused' || state.phase === 'quota_paused');
      paused = true;

      await vi.advanceTimersByTimeAsync(waitMs);
      await parked.promise;
      pipeline.stop();
      release.resolve();
      await run;

      expect(pipeline.getSnapshot().phase).toBe('cancelled');
      expect(transcribe).toHaveBeenCalledTimes(1);
      expect(markError).not.toHaveBeenCalled();
    } finally {
      pipeline.dispose();
    }
  });

  it('anchors the quota countdown to reset time after timer throttling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const adapter = makeAdapter({
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 5_000 }),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      void session.run();
      await waitForState(pipeline, (state) => state.phase === 'quota_paused');
      expect(pipeline.getSnapshot().waitSeconds).toBe(4);

      vi.setSystemTime(6_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(pipeline.getSnapshot().waitSeconds).toBe(0);
    } finally {
      pipeline.dispose();
    }
  });

  // docs/38 made the 'paused' wait minutes long (up to 30 min for a platform
  // cooldown): a throttled background tab fires the 1 s countdown tick far
  // less often, so the displayed seconds must come from the deadline.
  it('anchors the temporary-limit countdown to its deadline after timer throttling', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const transcribe = vi.fn().mockResolvedValue(rateLimited(2));
    const pipeline = new AutoTranscribePipeline(makeAdapter({ transcribe }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      void session.run();
      await waitForState(pipeline, (state) => state.phase === 'paused');
      expect(pipeline.getSnapshot().waitSeconds).toBe(60);

      // 50 s pass while no tick fires, then one tick.
      vi.setSystemTime(51_000);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(pipeline.getSnapshot().waitSeconds).toBe(9);
      expect(transcribe).toHaveBeenCalledTimes(1);
    } finally {
      pipeline.dispose();
    }
  });

  it('still starts after reset when clearing the expired guard fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const storageError = new Error('storage unavailable');
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const transcribe = vi.fn().mockResolvedValue(success());
    const adapter = makeAdapter({
      transcribe,
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 2_000 }),
      setQuotaPause: vi.fn().mockRejectedValue(storageError),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      vi.setSystemTime(3_000);
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      const run = session.run();
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledOnce());
      await waitForState(pipeline, (state) => state.phase === 'waiting');
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(consoleError).toHaveBeenCalledWith(
        '[auto-transcribe] Failed to clear quota pause:',
        storageError,
      );
    } finally {
      pipeline.dispose();
    }
  });
});
