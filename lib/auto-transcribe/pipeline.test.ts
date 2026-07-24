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
  });

  it('fetches the next page only after every pending video on the current page settles', async () => {
    vi.useFakeTimers();
    const first = deferred<TranscribeResponse>();
    const second = deferred<TranscribeResponse>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<void>();
    const fetchedPages: number[] = [];
    const transcribedVideos: string[] = [];

    const adapter: AutoTranscribeAdapter = {
      checkAuth: vi.fn().mockResolvedValue(undefined),
      fetchPage: vi.fn(async (_collectionId, page) => {
        fetchedPages.push(page);
        return page === 1
          ? { videos: [video('BV-1'), video('BV-2')], totalPages: 2, totalCount: 3 }
          : { videos: [video('BV-3')], totalPages: 2, totalCount: 3 };
      }),
      getPendingIds: vi.fn(async (videoIds) => pageOneIds(videoIds)),
      getPreview: vi.fn(),
      transcribe: vi.fn((videoId) => {
        transcribedVideos.push(videoId);
        if (videoId === 'BV-1') {
          firstStarted.resolve();
          return first.promise;
        }
        secondStarted.resolve();
        return second.promise;
      }),
      markError: vi.fn().mockResolvedValue(undefined),
      hasAsrKey: vi.fn().mockResolvedValue(false),
      createStatusListener: vi.fn(() => () => undefined),
    };
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
});

function pageOneIds(videoIds: string[]): string[] {
  return videoIds.filter((videoId) => videoId !== 'BV-3');
}
