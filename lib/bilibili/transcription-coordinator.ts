import type { SubtitleSource } from '@/lib/subtitle/types';
import type {
  TranscribeStage,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import type { BiliFavVideo } from './types';
import { transcribeAndPersist, createStatusListener } from './transcribe-utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentStatus = 'unknown' | 'checking' | 'has_official' | 'has_asr' | 'none';

export interface VideoTranscribeState {
  contentStatus: ContentStatus;
  transcribing: boolean;
  progress: number;
  stage: TranscribeStage | '';
  stageParams?: Record<string, string | number>;
  error: TranscribeErrorInfo | null;
  retryCountdown: number;
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

    this.stateMap = new Map(this.stateMap);
    for (const bvid of bvids) {
      if (!this.stateMap.has(bvid)) {
        this.stateMap.set(bvid, { ...DEFAULT_STATE, contentStatus: 'checking' });
      }
    }
    this.emit();

    Promise.all(
      bvids.map((bvid) =>
        browser.runtime
          .sendMessage({ type: 'GET_VIDEO_CACHE', platform: 'bilibili', videoId: bvid })
          .then((entry: unknown) => ({
            bvid,
            entry: entry as { rows: unknown[]; source: SubtitleSource } | null,
          }))
          .catch(() => ({ bvid, entry: null })),
      ),
    ).then((results) => {
      if (gen !== this.generation) return;

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

        this.stateMap.set(bvid, { ...(current ?? { ...DEFAULT_STATE }), contentStatus });
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

    transcribeAndPersist(bvid, title)
      .then((res) => {
        if (res.success) {
          this.patchVideo(bvid, {
            transcribing: false,
            progress: 100,
            stage: 'done',
            contentStatus: res.data.source === 'official' ? 'has_official' : 'has_asr',
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
