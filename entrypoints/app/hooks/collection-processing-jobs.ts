import type { CooperativeCheckpoint } from '@/lib/collections';
import {
  embedPlatformBacklog,
  embedPlatformItem,
  type IndexedContentState,
} from '@/lib/embedding';
import {
  tagNewItems,
  tagPlatformItem,
  type TagItemResult,
} from '@/lib/tagging';

import { startJob } from './background-jobs-store';

interface ProcessingProgress {
  done: number;
  total: number;
}

type ProcessingWorker = (
  platform: string,
  itemIds: string[],
  onProgress: (progress: ProcessingProgress) => void,
  control: CooperativeCheckpoint,
) => Promise<void>;

export interface CollectionProcessingJobDeps {
  embed: ProcessingWorker;
  tag: ProcessingWorker;
}

export interface StartCollectionProcessingJobsInput {
  jobPlatform: string;
  itemPlatform: string;
  itemIds: string[];
}

export interface EnqueueCollectionProcessingItemInput {
  jobPlatform: string;
  itemPlatform: string;
  itemId: string;
}

export interface CollectionProcessingTicket {
  embed: Promise<IndexedContentState | null>;
  tag: Promise<TagItemResult>;
}

export interface CollectionProcessingItemDeps {
  embed: (platform: string, itemId: string) => Promise<IndexedContentState | null>;
  tag: (platform: string, itemId: string) => Promise<TagItemResult>;
}

interface LaneQueueItem {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

interface ProcessingLaneState {
  active: boolean;
  queue: LaneQueueItem[];
  done: number;
  total: number;
}

const itemDeps: CollectionProcessingItemDeps = {
  embed: embedPlatformItem,
  tag: tagPlatformItem,
};

const streamLanes = new Map<string, ProcessingLaneState>();

const defaultDeps: CollectionProcessingJobDeps = {
  // The embed lane's input is the platform's WHOLE 'chunked' backlog — the ids
  // a sync just persisted are part of it by definition, and an earlier
  // interrupted run's leftovers get drained on the next dispatch instead of
  // waiting for the manual settings-page rebuild. itemIds are ignored here.
  embed: (platform, _itemIds, onProgress, control) =>
    embedPlatformBacklog(platform, undefined, onProgress, control),
  tag: (platform, itemIds, onProgress, control) =>
    tagNewItems(platform, itemIds, undefined, onProgress, control),
};

export function startCollectionProcessingJobs(
  { jobPlatform, itemPlatform, itemIds }: StartCollectionProcessingJobsInput,
  deps: CollectionProcessingJobDeps = defaultDeps,
): void {
  const ids = [...itemIds];

  // Embed ALWAYS dispatches — zero new items still means the backlog query
  // runs (it completes instantly at 0/0 when there is nothing to drain).
  startBatchLane(jobPlatform, 'embed', (setProgress, control) =>
    deps.embed(itemPlatform, ids, setProgress, control),
  );

  // Tags are per-item work on exactly the fresh ids — nothing to do on empty.
  if (ids.length === 0) return;
  startBatchLane(jobPlatform, 'tag', (setProgress, control) =>
    deps.tag(itemPlatform, ids, setProgress, control),
  );
}

function startBatchLane(
  jobPlatform: string,
  lane: 'embed' | 'tag',
  run: Parameters<typeof startJob>[2],
): void {
  const handle = startJob(jobPlatform, lane, run);
  if (handle.started) return;

  void handle.settled.then(() => startBatchLane(jobPlatform, lane, run));
}

export function enqueueCollectionProcessingItem(
  { jobPlatform, itemPlatform, itemId }: EnqueueCollectionProcessingItemInput,
  deps: CollectionProcessingItemDeps = itemDeps,
): CollectionProcessingTicket {
  return {
    embed: enqueueLane(
      jobPlatform,
      'embed',
      () => deps.embed(itemPlatform, itemId),
    ),
    tag: enqueueLane(
      jobPlatform,
      'tag',
      () => deps.tag(itemPlatform, itemId),
    ),
  };
}

function enqueueLane<TResult>(
  jobPlatform: string,
  lane: 'embed' | 'tag',
  run: () => Promise<TResult>,
): Promise<TResult> {
  const key = `${jobPlatform}:${lane}`;
  let state = streamLanes.get(key);
  if (!state) {
    state = { active: false, queue: [], done: 0, total: 0 };
    streamLanes.set(key, state);
  }
  if (!state.active && state.queue.length === 0) {
    state.done = 0;
    state.total = 0;
  }

  const promise = new Promise<TResult>((resolve, reject) => {
    state.queue.push({
      run,
      resolve: (value) => resolve(value as TResult),
      reject,
    });
    state.total += 1;
  });
  // The lane owns failure reporting; streaming adapters may intentionally ignore tickets.
  void promise.catch(() => undefined);
  wakeLane(jobPlatform, lane, state);
  return promise;
}

function wakeLane(
  jobPlatform: string,
  lane: 'embed' | 'tag',
  state: ProcessingLaneState,
): void {
  if (state.active || state.queue.length === 0) return;
  state.active = true;

  const handle = startJob(jobPlatform, lane, async (setProgress, control) => {
    let firstError: unknown = null;
    setProgress({ done: state.done, total: state.total });

    while (state.queue.length > 0) {
      await control.checkpoint();
      const item = state.queue.shift();
      if (!item) continue;
      try {
        item.resolve(await item.run());
      } catch (error) {
        firstError ??= error;
        item.reject(error);
      } finally {
        state.done += 1;
        setProgress({ done: state.done, total: state.total });
      }
    }

    if (firstError != null) throw firstError;
  });

  void handle.settled.finally(() => {
    state.active = false;
    if (state.queue.length > 0) wakeLane(jobPlatform, lane, state);
  });
}
