import type { SubtitleSource } from '@/lib/subtitle/types';
import type {
  TranscribeStage,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import type { BiliFavVideo } from './types';
import { transcribeAndPersist, createStatusListener } from './transcribe-utils';
import { getEmbeddedBvids, type PersistContentResult } from './bili-sync-service';
import { onVideoCacheChange } from '@/lib/cache/video-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentStatus = 'unknown' | 'checking' | 'has_official' | 'has_asr' | 'none';

/**
 * Background pipeline stages plus the local-only 'indexing' stage shown while
 * chunk+embed runs in app.html after transcription (not pushed by background).
 */
export type LocalTranscribeStage = TranscribeStage | 'indexing';

export interface VideoTranscribeState {
  contentStatus: ContentStatus;
  transcribing: boolean;
  progress: number;
  stage: LocalTranscribeStage | '';
  stageParams?: Record<string, string | number>;
  error: TranscribeErrorInfo | null;
  retryCountdown: number;
  /** True when the item's content_state is 'embedded' (RAG index built). */
  indexed: boolean;
}

export interface CoordinatorSnapshot {
  stateMap: Map<string, VideoTranscribeState>;
  activeBvid: string | null;
}

const DEFAULT_STATE: VideoTranscribeState = {
  contentStatus: 'unknown',
  transcribing: false,
  progress: 0,
  stage: '',
  error: null,
  retryCountdown: 0,
  indexed: false,
};

export { DEFAULT_STATE };

// ---------------------------------------------------------------------------
// TranscriptionCoordinator
// ---------------------------------------------------------------------------

export class TranscriptionCoordinator {
  private stateMap = new Map<string, VideoTranscribeState>();
  private activeBvid: string | null = null;
  private listeners = new Set<() => void>();
  private generation = 0;
  private statusCleanup: (() => void) | null = null;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private countdownBvid: string | null = null;
  private cacheUnsubscribes: Array<() => void> = [];

  /**
   * Optional injection seam used by the app layer to reflect a running manual
   * transcription as a global background job (running-state only). The
   * coordinator itself stays store-agnostic (zero React / app-layer imports —
   * layering preserved); the app-layer hook passes a callback that wraps the
   * floating `transcribeAndPersist` promise into `startJob('bilibili',
   * 'transcribe', …), and observes its independent Embedding/Tagging promises
   * through the second callback. A no-arg `new TranscriptionCoordinator()` still works.
   */
  constructor(
    private trackRun?: (bvid: string, run: Promise<unknown>) => void,
    private trackProcessingRun?: (
      kind: 'embed' | 'tag',
      run: Promise<unknown>,
    ) => void,
  ) {}

  // --- useSyncExternalStore contract ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): CoordinatorSnapshot => this.snapshot;

  private snapshot: CoordinatorSnapshot = { stateMap: this.stateMap, activeBvid: this.activeBvid };

  private emit(): void {
    this.snapshot = { stateMap: this.stateMap, activeBvid: this.activeBvid };
    for (const listener of this.listeners) listener();
  }

  // --- Public API ---

  getVideoState(bvid: string): VideoTranscribeState {
    return this.stateMap.get(bvid) ?? DEFAULT_STATE;
  }

  setVideos(videos: BiliFavVideo[]): void {
    this.generation++;
    const gen = this.generation;

    const validVideos = videos.filter((v) => v.attr !== 9 && v.bvid);
    if (validVideos.length === 0) return;

    const bvids = validVideos.map((v) => v.bvid);

    this.unsubscribeCache();
    this.subscribeCacheChanges(bvids);

    this.stateMap = new Map(this.stateMap);
    for (const bvid of bvids) {
      if (!this.stateMap.has(bvid)) {
        this.stateMap.set(bvid, { ...DEFAULT_STATE, contentStatus: 'checking' });
      }
    }
    this.emit();

    const cacheQuery = Promise.all(
      bvids.map((bvid) =>
        browser.runtime
          .sendMessage({ type: 'GET_VIDEO_CACHE', platform: 'bilibili', videoId: bvid })
          .then((entry: unknown) => ({
            bvid,
            entry: entry as { rows: unknown[]; source: SubtitleSource } | null,
          }))
          .catch(() => ({ bvid, entry: null })),
      ),
    );
    // Parallel DB query for the "indexed" chip (content_state = 'embedded').
    const embeddedQuery = getEmbeddedBvids(bvids).catch(() => [] as string[]);

    Promise.all([cacheQuery, embeddedQuery]).then(([results, embeddedBvids]) => {
      if (gen !== this.generation) return;

      const embeddedSet = new Set(embeddedBvids);
      this.stateMap = new Map(this.stateMap);
      for (const { bvid, entry } of results) {
        const current = this.stateMap.get(bvid);
        if (current?.transcribing) continue;

        const contentStatus: ContentStatus =
          entry
            ? entry.source === 'official'
              ? 'has_official'
              : 'has_asr'
            : 'none';

        this.stateMap.set(bvid, {
          ...(current ?? { ...DEFAULT_STATE }),
          contentStatus,
          indexed: embeddedSet.has(bvid),
        });
      }
      this.emit();
    });
  }

  transcribe(video: BiliFavVideo): void {
    if (this.activeBvid) return;
    if (video.attr === 9) return;

    const { bvid, title } = video;
    this.activeBvid = bvid;
    this.countdownBvid = null;
    this.clearCountdown();

    this.patchVideo(bvid, {
      transcribing: true,
      progress: 0,
      stage: 'start',
      error: null,
      retryCountdown: 0,
    });

    this.installStatusListener();

    let indexResult: PersistContentResult = null;

    const run = transcribeAndPersist(bvid, title, {
      // Local stage: shown while chunk+embed runs after the background 'done'.
      onIndexing: () => this.patchVideo(bvid, { progress: 100, stage: 'indexing' }),
      onIndexed: (result) => { indexResult = result; },
      onEmbeddingRun: (processingRun) => this.trackProcessingRun?.('embed', processingRun),
      onTaggingRun: (processingRun) => this.trackProcessingRun?.('tag', processingRun),
    });

    // Reflect the run as a global background job (running-state only). Reported
    // before the coordinator's own chain so the job starts as soon as the run
    // does; the promise floats to completion even after this coordinator is
    // disposed (route switch), so the job clears when transcription finishes.
    this.trackRun?.(bvid, run);

    run
      .then((res) => {
        if (res.success) {
          this.patchVideo(bvid, {
            transcribing: false,
            progress: 100,
            stage: 'done',
            contentStatus: res.data.source === 'official' ? 'has_official' : 'has_asr',
            indexed: indexResult === 'embedded',
            error: null,
          });
        } else {
          this.patchVideo(bvid, {
            transcribing: false,
            error: res.error,
          });

          if (res.error.retryAfter) {
            this.countdownBvid = bvid;
            this.startCountdown(res.error.retryAfter);
          }
        }
      })
      .catch((err: unknown) => {
        const detail = err instanceof Error ? err.message : 'unknown error';
        this.patchVideo(bvid, {
          transcribing: false,
          error: {
            code: 'ASR_UNKNOWN',
            message: detail,
            params: { detail },
          },
        });
      })
      .finally(() => {
        if (this.activeBvid === bvid) {
          this.activeBvid = null;
        }
        this.removeStatusListener();
        this.emit();
      });
  }

  cancel(): void {
    if (!this.activeBvid) return;
    const bvid = this.activeBvid;

    browser.runtime
      .sendMessage({ type: 'TRANSCRIBE_ABORT', videoId: bvid })
      .catch(() => {});

    this.patchVideo(bvid, {
      transcribing: false,
      stage: 'cancelled',
    });
    this.activeBvid = null;
    this.removeStatusListener();
    this.emit();
  }

  dispose(): void {
    this.removeStatusListener();
    this.clearCountdown();
    this.unsubscribeCache();
    this.listeners.clear();
  }

  // --- Private: state helpers ---

  private patchVideo(bvid: string, patch: Partial<VideoTranscribeState>): void {
    this.stateMap = new Map(this.stateMap);
    const current = this.stateMap.get(bvid) ?? { ...DEFAULT_STATE };
    this.stateMap.set(bvid, { ...current, ...patch });
    this.emit();
  }

  // --- Private: countdown ---

  private startCountdown(seconds: number): void {
    this.clearCountdown();
    let remaining = seconds;

    if (this.countdownBvid) {
      this.patchVideo(this.countdownBvid, { retryCountdown: remaining });
    }

    this.countdownTimer = setInterval(() => {
      remaining--;
      const target = this.countdownBvid;
      if (remaining <= 0) {
        this.clearCountdown();
        if (target) {
          this.patchCountdown(target, 0);
          this.countdownBvid = null;
        }
      } else if (target) {
        this.patchCountdown(target, remaining);
      }
    }, 1000);
  }

  private patchCountdown(bvid: string, value: number): void {
    const current = this.stateMap.get(bvid);
    if (!current) return;
    this.stateMap.set(bvid, { ...current, retryCountdown: value });
    this.emit();
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  // --- Private: cache change subscription ---

  private subscribeCacheChanges(bvids: string[]): void {
    for (const bvid of bvids) {
      const unsub = onVideoCacheChange('bilibili', bvid, (entry) => {
        const current = this.stateMap.get(bvid);
        if (current?.transcribing) return;

        const contentStatus: ContentStatus =
          entry.source === 'official' ? 'has_official' : 'has_asr';

        if (current?.contentStatus === contentStatus) return;

        this.patchVideo(bvid, { contentStatus });
      });
      this.cacheUnsubscribes.push(unsub);
    }
  }

  private unsubscribeCache(): void {
    for (const unsub of this.cacheUnsubscribes) unsub();
    this.cacheUnsubscribes = [];
  }

  // --- Private: TRANSCRIBE_STATUS listener ---

  private installStatusListener(): void {
    this.removeStatusListener();
    this.statusCleanup = createStatusListener(
      () => this.activeBvid ?? '',
      ({ progress, stage, stageParams, error }) => {
        if (!this.activeBvid) return;
        this.patchVideo(this.activeBvid, {
          progress,
          stage,
          stageParams,
          error: error ?? null,
        });
      },
    );
  }

  private removeStatusListener(): void {
    if (this.statusCleanup) {
      this.statusCleanup();
      this.statusCleanup = null;
    }
  }
}
