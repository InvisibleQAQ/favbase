import type { CollectionPlatform, CooperativeCheckpoint } from '@/lib/collections';
import {
  embedPlatformBacklog,
  embedPlatformItem,
  type IndexedContentState,
} from '@/lib/embedding';
import {
  createEmbeddingTraceId,
  embeddingTrace,
  embeddingTraceError,
  type EmbeddingTraceDetails,
} from '@/lib/embedding/diagnostics';
import {
  tagNewItems,
  tagPlatformBacklog,
  tagPlatformItem,
  type TagItemResult,
} from '@/lib/tagging';

import { getJob, startJob, type JobCollisionPolicy } from './background-jobs-store';

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

type ProcessingBacklogWorker = (
  platform: CollectionPlatform,
  onProgress: (progress: ProcessingProgress) => void,
  control: CooperativeCheckpoint,
) => Promise<void>;

export interface CollectionProcessingBacklogDeps {
  embed: ProcessingBacklogWorker;
  tag: ProcessingBacklogWorker;
}

export type CollectionProcessingCapability = 'embedding' | 'llm';

export interface StartCollectionProcessingBacklogInput {
  jobPlatform: string;
  itemPlatform: CollectionPlatform;
  capability: CollectionProcessingCapability;
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
  diagnostic?: EmbeddingTraceDetails;
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

const defaultBacklogDeps: CollectionProcessingBacklogDeps = {
  embed: (platform, onProgress, control) =>
    embedPlatformBacklog(platform, undefined, onProgress, control),
  tag: (platform, onProgress, control) =>
    tagPlatformBacklog(platform, undefined, onProgress, control),
};

/** Schedule one provider-specific platform backlog through the existing lane. */
export function startCollectionProcessingBacklog(
  { jobPlatform, itemPlatform, capability }: StartCollectionProcessingBacklogInput,
  deps: CollectionProcessingBacklogDeps = defaultBacklogDeps,
): void {
  if (capability === 'llm') {
    startBatchLane(jobPlatform, 'tag', (setProgress, control) =>
      deps.tag(itemPlatform, setProgress, control),
    );
    return;
  }

  const diagnostic: EmbeddingTraceDetails = {
    traceId: createEmbeddingTraceId('resume'),
    platform: itemPlatform,
    jobPlatform,
    source: 'resume',
    stage: 'scheduler',
  };
  embeddingTrace('scheduler:batch-dispatch', diagnostic);
  startBatchLane(
    jobPlatform,
    'embed',
    (setProgress, control) => deps.embed(itemPlatform, setProgress, control),
    diagnostic,
  );
}

export function startCollectionProcessingJobs(
  { jobPlatform, itemPlatform, itemIds }: StartCollectionProcessingJobsInput,
  deps: CollectionProcessingJobDeps = defaultDeps,
): void {
  const ids = [...itemIds];
  const embedDiagnostic: EmbeddingTraceDetails = {
    traceId: createEmbeddingTraceId('batch'),
    platform: itemPlatform,
    jobPlatform,
    source: 'batch',
    stage: 'scheduler',
  };

  // Embed ALWAYS dispatches — zero new items still means the backlog query
  // runs (it completes instantly at 0/0 when there is nothing to drain).
  embeddingTrace('scheduler:batch-dispatch', embedDiagnostic);
  startBatchLane(
    jobPlatform,
    'embed',
    (setProgress, control) => deps.embed(itemPlatform, ids, setProgress, control),
    embedDiagnostic,
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
  diagnostic?: EmbeddingTraceDetails,
): void {
  // Collision policy is declared here, executed by the job store: embed batch
  // runners are interchangeable whole-backlog drains, so colliding dispatches
  // coalesce into ONE pending drain; tag batches carry distinct fresh ids, so
  // every dispatch queues and runs. Neither ever discards work.
  const handle = startObservedJob(
    jobPlatform,
    lane,
    run,
    lane === 'embed' ? 'coalesce' : 'queue',
    diagnostic,
  );
  if (diagnostic && handle.dispatch !== 'started') {
    embeddingTrace(`scheduler:batch-${handle.dispatch}`, diagnostic);
  }
}

function progressTraceDetails(progress: unknown): EmbeddingTraceDetails {
  if (typeof progress !== 'object' || progress == null) return {};
  const candidate = progress as Record<string, unknown>;
  return {
    ...(typeof candidate.done === 'number' ? { done: candidate.done } : {}),
    ...(typeof candidate.total === 'number' ? { total: candidate.total } : {}),
    ...(typeof candidate.failed === 'number' ? { failed: candidate.failed } : {}),
  };
}

function startObservedJob(
  jobPlatform: string,
  lane: 'embed' | 'tag',
  run: Parameters<typeof startJob>[2],
  collision: JobCollisionPolicy,
  diagnostic?: EmbeddingTraceDetails,
) {
  if (!diagnostic) return startJob(jobPlatform, lane, run, collision);

  // Terminal traces live INSIDE the wrapper (not on handle.settled): by the
  // time a queued run's settled resolves, the store may already have started
  // the next pending run, so a snapshot read there could describe the wrong
  // run. The wrapper knows this run's outcome and last progress first-hand.
  // A coalesced dispatch's wrapper is discarded with its runner — the pending
  // run it merged into logs its own single terminal event.
  const startedAt = Date.now();
  let lastProgress: unknown = null;
  const observedRun: Parameters<typeof startJob>[2] = async (setProgress, control) => {
    embeddingTrace('job:started', {
      ...diagnostic,
      stage: 'job',
      phase: getJob(jobPlatform, lane)?.phase,
      elapsedMs: Date.now() - startedAt,
    });
    try {
      await run((progress) => {
        lastProgress = progress;
        setProgress(progress);
        embeddingTrace('job:progress', {
          ...diagnostic,
          ...progressTraceDetails(progress),
          stage: 'job',
          phase: 'running',
          elapsedMs: Date.now() - startedAt,
        });
      }, control);
      embeddingTrace('job:completed', {
        ...diagnostic,
        ...progressTraceDetails(lastProgress),
        stage: 'job',
        phase: 'completed',
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      embeddingTraceError('job:failed', error, {
        ...diagnostic,
        ...progressTraceDetails(lastProgress),
        stage: 'job',
        phase: 'failed',
        elapsedMs: Date.now() - startedAt,
      });
      throw error;
    }
  };
  return startJob(jobPlatform, lane, observedRun, collision);
}

export function enqueueCollectionProcessingItem(
  { jobPlatform, itemPlatform, itemId }: EnqueueCollectionProcessingItemInput,
  deps: CollectionProcessingItemDeps = itemDeps,
): CollectionProcessingTicket {
  const embedDiagnostic: EmbeddingTraceDetails = {
    traceId: createEmbeddingTraceId('stream-item'),
    platform: itemPlatform,
    jobPlatform,
    platformItemId: itemId,
    source: 'stream',
    stage: 'scheduler',
  };
  return {
    embed: enqueueLane(
      jobPlatform,
      'embed',
      () => deps.embed(itemPlatform, itemId),
      embedDiagnostic,
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
  diagnostic?: EmbeddingTraceDetails,
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
      diagnostic,
    });
    state.total += 1;
  });
  if (diagnostic) {
    embeddingTrace('scheduler:stream-enqueued', {
      ...diagnostic,
      done: state.done,
      total: state.total,
      queueDepth: state.queue.length,
    });
  }
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
  const laneDiagnostic = state.queue[0]?.diagnostic;
  if (laneDiagnostic) {
    embeddingTrace('scheduler:stream-wake', {
      ...laneDiagnostic,
      done: state.done,
      total: state.total,
      queueDepth: state.queue.length,
    });
  }

  // 'queue' parks the drain behind an active batch run on the same lane; the
  // store starts it at settlement. Items keep joining the inbox meanwhile.
  const handle = startObservedJob(jobPlatform, lane, async (setProgress, control) => {
    let firstError: unknown = null;
    setProgress({ done: state.done, total: state.total });

    while (state.queue.length > 0) {
      await control.checkpoint();
      const item = state.queue.shift();
      if (!item) continue;
      if (item.diagnostic) {
        embeddingTrace('scheduler:stream-item-started', {
          ...item.diagnostic,
          done: state.done,
          total: state.total,
          queueDepth: state.queue.length,
        });
      }
      try {
        item.resolve(await item.run());
      } catch (error) {
        firstError ??= error;
        item.reject(error);
      } finally {
        state.done += 1;
        setProgress({ done: state.done, total: state.total });
        if (item.diagnostic) {
          embeddingTrace('scheduler:stream-item-settled', {
            ...item.diagnostic,
            done: state.done,
            total: state.total,
            queueDepth: state.queue.length,
          });
        }
      }
    }

    if (laneDiagnostic) {
      embeddingTrace('scheduler:stream-drained', {
        ...laneDiagnostic,
        done: state.done,
        total: state.total,
        queueDepth: state.queue.length,
      });
    }
    if (firstError != null) throw firstError;
  }, 'queue', laneDiagnostic);

  if (handle.dispatch === 'queued' && laneDiagnostic) {
    embeddingTrace('scheduler:stream-queued', laneDiagnostic);
  }

  void handle.settled.finally(() => {
    state.active = false;
    // Items can land between the drain loop's last empty check and settlement.
    if (state.queue.length > 0) wakeLane(jobPlatform, lane, state);
  });
}
