import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoTranscribePipeline } from '@/lib/auto-transcribe/pipeline';
import type { AutoTranscribeVideo } from '@/lib/auto-transcribe/types';

import { startJob } from './background-jobs-store';
import { createTranscriptLane } from './transcript-lane';

// Ported from sections/bilibili/auto-transcribe-runtime.test.ts when the
// producer / dispatch code moved here (docs/37 Step 3 ruling 6). The job
// store is a module singleton with no reset, so every case gets its own
// namespace.

const mocks = vi.hoisted(() => ({
  append: vi.fn(),
  close: vi.fn(),
  run: vi.fn(),
  finishSession: null as (() => void) | null,
  sessionClosed: false,
  createSession: vi.fn(),
  getSnapshot: vi.fn(() => ({ totalVideos: 0, currentIndex: 0 })),
  subscribe: vi.fn((_listener: () => void) => () => undefined),
}));

const fakePipeline = {
  createSession: mocks.createSession,
  getSnapshot: mocks.getSnapshot,
  subscribe: mocks.subscribe,
} as unknown as AutoTranscribePipeline;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function video(videoId: string): AutoTranscribeVideo {
  return { videoId, title: videoId, cover: '', author: 'UP', duration: 60 };
}

let namespace = 0;
function jobPlatform(): string {
  namespace += 1;
  return `transcript-lane-test-${namespace}`;
}

describe('createTranscriptLane', () => {
  beforeEach(() => {
    mocks.append.mockReset();
    mocks.sessionClosed = false;
    mocks.close.mockReset().mockImplementation(() => {
      mocks.sessionClosed = true;
      mocks.finishSession?.();
    });
    mocks.run.mockReset().mockImplementation(
      () => mocks.sessionClosed
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            mocks.finishSession = resolve;
          }),
    );
    mocks.finishSession = null;
    mocks.createSession.mockReset().mockReturnValue({
      append: mocks.append,
      close: mocks.close,
      run: mocks.run,
    });
    mocks.getSnapshot.mockReset().mockReturnValue({ totalVideos: 0, currentIndex: 0 });
    mocks.subscribe.mockReset().mockReturnValue(() => undefined);
  });

  it('starts one session from the first append and keeps appending to it until close', async () => {
    const producer = createTranscriptLane(fakePipeline, jobPlatform()).createProducer();

    producer.append([video('V-1')]);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());

    producer.append([video('V-2')]);
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(mocks.append).toHaveBeenCalledTimes(2);
    expect(mocks.append.mock.calls.map(([videos]) => videos)).toEqual([[video('V-1')], [video('V-2')]]);

    producer.close();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('an empty append starts nothing, and a closed producer drops what comes after', async () => {
    const producer = createTranscriptLane(fakePipeline, jobPlatform()).createProducer();

    producer.append([]);
    producer.close();
    producer.append([video('V-LATE')]);
    await Promise.resolve();

    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('closing after a failure lets the already-published items drain', async () => {
    const producer = createTranscriptLane(fakePipeline, jobPlatform()).createProducer();

    producer.append([video('V-SAVED')]);
    producer.close();
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());

    expect(mocks.append).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it('retains the stream while a manual transcription owns the job key', async () => {
    const platform = jobPlatform();
    const manual = deferred<void>();
    const manualJob = startJob(platform, 'transcribe', () => manual.promise);
    const producer = createTranscriptLane(fakePipeline, platform).createProducer();

    producer.append([video('V-AFTER-MANUAL')]);
    producer.close();
    await Promise.resolve();
    expect(mocks.run).not.toHaveBeenCalled();

    manual.resolve();
    await manualJob.settled;
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    expect(mocks.append).toHaveBeenCalledOnce();
  });

  it('serializes a later producer behind the active session of the same lane', async () => {
    const firstDrain = deferred<void>();
    const firstSession = { append: vi.fn(), close: vi.fn(), run: vi.fn(() => firstDrain.promise) };
    const secondSession = { append: vi.fn(), close: vi.fn(), run: vi.fn(async () => undefined) };
    mocks.createSession
      .mockReset()
      .mockReturnValueOnce(firstSession)
      .mockReturnValueOnce(secondSession);
    const lane = createTranscriptLane(fakePipeline, jobPlatform());

    const first = lane.createProducer();
    first.append([video('V-FIRST-FETCH')]);
    first.close();
    await vi.waitFor(() => expect(firstSession.run).toHaveBeenCalledOnce());

    const second = lane.createProducer();
    second.append([video('V-SECOND-FETCH')]);
    second.close();
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(secondSession.run).not.toHaveBeenCalled();

    firstDrain.resolve();
    await vi.waitFor(() => expect(secondSession.run).toHaveBeenCalledOnce());

    expect(mocks.createSession).toHaveBeenCalledTimes(2);
    expect(firstSession.append).toHaveBeenCalledOnce();
    expect(secondSession.append).toHaveBeenCalledOnce();
    expect(firstSession.close).toHaveBeenCalledOnce();
    expect(secondSession.close).toHaveBeenCalledOnce();
  });

  it('does not serialize across lanes: a second lane runs while the first is still draining', async () => {
    const firstDrain = deferred<void>();
    const firstSession = { append: vi.fn(), close: vi.fn(), run: vi.fn(() => firstDrain.promise) };
    const otherSession = { append: vi.fn(), close: vi.fn(), run: vi.fn(async () => undefined) };
    mocks.createSession
      .mockReset()
      .mockReturnValueOnce(firstSession)
      .mockReturnValueOnce(otherSession);

    const busy = createTranscriptLane(fakePipeline, jobPlatform()).createProducer();
    busy.append([video('V-BUSY')]);
    busy.close();
    await vi.waitFor(() => expect(firstSession.run).toHaveBeenCalledOnce());

    const other = createTranscriptLane(fakePipeline, jobPlatform()).createProducer();
    other.append([video('V-OTHER')]);
    other.close();
    await vi.waitFor(() => expect(otherSession.run).toHaveBeenCalledOnce());

    firstDrain.resolve();
  });

  it('publishes the session snapshot as the transcribe job progress', async () => {
    const platform = jobPlatform();
    let listener: (() => void) | null = null;
    mocks.subscribe.mockImplementation((next: () => void) => {
      listener = next;
      return () => undefined;
    });
    mocks.getSnapshot.mockReturnValue({ totalVideos: 3, currentIndex: 1 });
    const producer = createTranscriptLane(fakePipeline, platform).createProducer();

    producer.append([video('V-1')]);
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledOnce());
    const { getJob } = await import('./background-jobs-store');
    expect(getJob(platform, 'transcribe')?.progress).toEqual({ done: 1, total: 3 });

    mocks.getSnapshot.mockReturnValue({ totalVideos: 3, currentIndex: 2 });
    listener!();
    expect(getJob(platform, 'transcribe')?.progress).toEqual({ done: 2, total: 3 });

    producer.close();
  });
});
