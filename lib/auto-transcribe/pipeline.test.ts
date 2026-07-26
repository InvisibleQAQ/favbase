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
    isInvalid: false,
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
    checkAuth: vi.fn().mockResolvedValue(undefined),
    fetchPage: vi.fn(),
    getPendingIds: vi.fn(async (videoIds) => videoIds),
    getPreview: vi.fn(),
    transcribe: vi.fn(),
    markError: vi.fn().mockResolvedValue(undefined),
    hasAsrKey: vi.fn().mockResolvedValue(true),
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

describe('AutoTranscribePipeline page ordering', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('fetches the next page only after every pending video on the current page settles', async () => {
    vi.useFakeTimers();
    const first = deferred<TranscribeResponse>();
    const second = deferred<TranscribeResponse>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const fetchedPages: number[] = [];
    const transcribedVideos: string[] = [];

    const adapter = makeAdapter({
      fetchPage: vi.fn(async (_collectionId, page) => {
        fetchedPages.push(page);
        return page === 1
          ? { videos: [video('BV-1'), video('BV-2')], totalPages: 2, totalCount: 3 }
          : { videos: [video('BV-3')], totalPages: 2, totalCount: 3 };
      }),
      getPendingIds: vi.fn(async (videoIds) => pageOneIds(videoIds)),
      transcribe: vi.fn((videoId) => {
        transcribedVideos.push(videoId);
        if (videoId === 'BV-1') {
          firstStarted.resolve();
          return first.promise;
        }
        secondStarted.resolve();
        return second.promise;
      }),
      hasAsrKey: vi.fn().mockResolvedValue(false),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    pipeline.start('collection-1');
    await firstStarted.promise;
    expect(fetchedPages).toEqual([1]);

    first.resolve(success());
    await waitForState(
      pipeline,
      (state) => state.phase === 'waiting' && state.currentVideoId === 'BV-1',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await secondStarted.promise;
    expect(fetchedPages).toEqual([1]);

    second.resolve(success());
    await waitForState(
      pipeline,
      (state) => state.phase === 'waiting' && state.currentVideoId === 'BV-2',
    );
    expect(fetchedPages).toEqual([1]);

    await vi.advanceTimersByTimeAsync(20_000);
    await waitForState(pipeline, (state) => state.phase === 'done');

    expect(fetchedPages).toEqual([1, 2]);
    expect(transcribedVideos).toEqual(['BV-1', 'BV-2']);
    pipeline.dispose();
  });

  it('stops before claiming another video when the daily audio allowance is exhausted', async () => {
    const transcribe = vi.fn().mockResolvedValue(dailyQuotaExceeded());
    const setQuotaPause = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      fetchPage: vi.fn().mockResolvedValue({
        videos: [video('BV-1'), video('BV-2')],
        totalPages: 1,
        totalCount: 2,
      }),
      transcribe,
      setQuotaPause,
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      pipeline.start('collection-1');

      await vi.waitFor(() => {
        expect(pipeline.getSnapshot().phase).toBe('quota_paused');
      });

      expect(transcribe).toHaveBeenCalledOnce();
      expect(setQuotaPause).toHaveBeenCalledWith({ providerId: 'groq', resetAt: 4_600_000 });
      expect(pipeline.getSnapshot()).toMatchObject({
        quotaResetAt: 4_600_000,
        stats: { skipped: 0, remaining: 2 },
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
      fetchPage: vi.fn().mockResolvedValue({
        videos: [video('BV-1')],
        totalPages: 1,
        totalCount: 1,
      }),
      transcribe,
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      pipeline.start('collection-1');
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

  it('stops when the retry response reports daily quota exhaustion', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn()
      .mockResolvedValueOnce(rateLimited(1))
      .mockResolvedValueOnce(dailyQuotaExceeded());
    const setQuotaPause = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      fetchPage: vi.fn().mockResolvedValue({
        videos: [video('BV-1'), video('BV-2')],
        totalPages: 1,
        totalCount: 2,
      }),
      transcribe,
      setQuotaPause,
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      pipeline.start('collection-1');
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

  it('blocks a new run while a persisted quota pause is still active', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const checkAuth = vi.fn().mockResolvedValue(undefined);
    const fetchPage = vi.fn();
    const adapter = makeAdapter({
      checkAuth,
      fetchPage,
      getPreview: vi.fn().mockResolvedValue({ video: null, pendingCount: 2 }),
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 5_000 }),
      setQuotaPause: vi.fn(),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      await pipeline.queryPreview('collection-1');
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'quota_paused',
        quotaResetAt: 5_000,
        previewLoading: false,
      });

      await pipeline.start('collection-1');
      expect(checkAuth).not.toHaveBeenCalled();
      expect(fetchPage).not.toHaveBeenCalled();
    } finally {
      pipeline.dispose();
    }
  });

  it('blocks an automatic start on a fresh instance while the durable guard is active', async () => {
    // Race fix: a fresh instance's in-memory quotaResetAt is null until an
    // async preview lands. An automatic start (post-fetch chain / daily
    // auto-sync) must await the persisted guard instead of trusting memory.
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const checkAuth = vi.fn().mockResolvedValue(undefined);
    const fetchPage = vi.fn();
    const adapter = makeAdapter({
      checkAuth,
      fetchPage,
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 5_000 }),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      await pipeline.start('collection-1'); // NO queryPreview before this
      expect(checkAuth).not.toHaveBeenCalled();
      expect(fetchPage).not.toHaveBeenCalled();
      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'quota_paused',
        quotaResetAt: 5_000,
      });
    } finally {
      pipeline.dispose();
    }
  });

  it('blocks before claiming the next video when the cooperative checkpoint pauses', async () => {
    vi.useFakeTimers();
    const transcribe = vi.fn().mockResolvedValue(success());
    const adapter = makeAdapter({
      fetchPage: vi.fn().mockResolvedValue({
        videos: [video('BV-1'), video('BV-2')],
        totalPages: 1,
        totalCount: 2,
      }),
      transcribe,
    });
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
      const run = pipeline.start('collection-1', control);
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

  it('requires an explicit start after the quota reset time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const checkAuth = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      checkAuth,
      fetchPage: vi.fn().mockResolvedValue({ videos: [], totalPages: 0, totalCount: 0 }),
      getPreview: vi.fn().mockResolvedValue({ video: null, pendingCount: 1 }),
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 2_000 }),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      await pipeline.queryPreview('collection-1');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(pipeline.getSnapshot()).toMatchObject({
        phase: 'quota_paused',
        waitSeconds: 0,
      });
      expect(checkAuth).not.toHaveBeenCalled();

      pipeline.start('collection-1');
      await vi.waitFor(() => expect(checkAuth).toHaveBeenCalledOnce());
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
      await pipeline.queryPreview('collection-1');
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
    const checkAuth = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      checkAuth,
      fetchPage: vi.fn().mockResolvedValue({ videos: [], totalPages: 0, totalCount: 0 }),
      getQuotaPause: vi.fn().mockResolvedValue({ providerId: 'groq', resetAt: 2_000 }),
      setQuotaPause: vi.fn().mockRejectedValue(storageError),
    });
    const pipeline = new AutoTranscribePipeline(adapter);

    try {
      await pipeline.queryPreview('collection-1');
      vi.setSystemTime(3_000);
      pipeline.start('collection-1');
      await vi.waitFor(() => expect(checkAuth).toHaveBeenCalledOnce());

      expect(consoleError).toHaveBeenCalledWith(
        '[auto-transcribe] Failed to clear quota pause:',
        storageError,
      );
    } finally {
      pipeline.dispose();
    }
  });
});

function pageOneIds(videoIds: string[]): string[] {
  return videoIds.filter((videoId) => videoId !== 'BV-3');
}
