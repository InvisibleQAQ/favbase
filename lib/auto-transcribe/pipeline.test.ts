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

function success(): TranscribeResponse {
  return {
    success: true,
    data: { rows: [], source: 'official', cached: false },
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
    hasAsrKey: vi.fn().mockResolvedValue(true),
    waitForAsrKey: vi.fn().mockResolvedValue(undefined),
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
    const waitForAsrKey = vi.fn(() => configured.promise);
    const checkpoint = vi.fn(async () => undefined);
    const pipeline = new AutoTranscribePipeline(makeAdapter({
      transcribe,
      hasAsrKey: vi.fn().mockResolvedValue(false),
      waitForAsrKey,
    }));

    try {
      const session = pipeline.createSession();
      session.append([video('BV-NEEDS-ASR')]);
      session.close();
      const run = session.run({ checkpoint });

      await waitForState(pipeline, (state) => state.phase === 'configuration_required');
      expect(transcribe).toHaveBeenCalledOnce();
      expect(waitForAsrKey).toHaveBeenCalledOnce();
      expect(pipeline.getSnapshot()).toMatchObject({
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
      hasAsrKey: vi.fn().mockResolvedValue(false),
      waitForAsrKey,
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
        asrBlocked: true,
        currentIndex: 1,
        stats: { remaining: 1 },
      });

      await vi.advanceTimersByTimeAsync(20_000);
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'configuration_required',
        asrBlocked: true,
      });

      configured.resolve();
      await vi.advanceTimersByTimeAsync(20_000);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(3));
      expect(transcribe.mock.calls[2][0]).toBe('BV-NEEDS-ASR');
      await vi.advanceTimersByTimeAsync(20_000);
      await run;

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'done',
        asrBlocked: false,
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
      hasAsrKey: vi.fn().mockResolvedValue(false),
      waitForAsrKey,
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
        asrBlocked: true,
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
        asrBlocked: false,
        currentIndex: 2,
        stats: { remaining: 0 },
      });
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

  it('waits for the provider retry delay before retrying a temporary rate limit', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(rateLimited(2))
      .mockResolvedValueOnce(success());
    const adapter = makeAdapter({
      transcribe,
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      const session = pipeline.createSession();
      session.append([video('BV-1')]);
      session.close();
      void session.run();
      await waitForState(pipeline, (state) => state.phase === 'paused');

      expect(pipeline.getSnapshot().waitSeconds).toBe(2);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(transcribe).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      await vi.waitFor(() => expect(transcribe).toHaveBeenCalledTimes(2));
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
      await vi.advanceTimersByTimeAsync(1_000);

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
