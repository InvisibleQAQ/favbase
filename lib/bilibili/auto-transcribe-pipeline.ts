import {
  checkAuth,
  fetchAndSyncVideos,
  getPendingBvids,
  getPendingPreview,
  markVideoError,
} from './bili-sync-service';
import { transcribeAndPersist, createStatusListener } from './transcribe-utils';
import { normalizeCover } from './url-utils';
import { getAsrSettings } from '@/lib/storage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AutoTranscribePhase =
  | 'idle'
  | 'syncing'
  | 'transcribing'
  | 'waiting'
  | 'paused'
  | 'done'
  | 'cancelled';

export interface AutoTranscribeStats {
  cc: number;
  asr: number;
  skipped: number;
  remaining: number;
}

export interface AutoTranscribeCurrentVideo {
  cover: string;
  title: string;
  upper: string;
  duration: number;
}

export interface AutoTranscribeState {
  phase: AutoTranscribePhase;
  currentPage: number;
  totalPages: number;
  currentVideoTitle: string;
  currentVideoBvid: string;
  currentVideo: AutoTranscribeCurrentVideo | null;
  totalVideos: number;
  currentIndex: number;
  videoProgress: number;
  videoStage: string;
  waitSeconds: number;
  stats: AutoTranscribeStats;
  previewVideo: AutoTranscribeCurrentVideo | null;
  pendingCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_STATE: AutoTranscribeState = {
  phase: 'idle',
  currentPage: 0,
  totalPages: 0,
  currentVideoTitle: '',
  currentVideoBvid: '',
  currentVideo: null,
  totalVideos: 0,
  currentIndex: 0,
  videoProgress: 0,
  videoStage: '',
  waitSeconds: 0,
  stats: { cc: 0, asr: 0, skipped: 0, remaining: 0 },
  previewVideo: null,
  pendingCount: 0,
};

const PAGE_SIZE = 20;
const RATE_LIMIT_PAUSE_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomDelay(minS: number, maxS: number): number {
  return (minS + Math.random() * (maxS - minS)) * 1000;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export class AutoTranscribePipeline {
  private state: AutoTranscribeState = { ...INITIAL_STATE };
  private listeners = new Set<() => void>();
  private ac: AbortController | null = null;
  private running = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private statusCleanup: (() => void) | null = null;
  private previewGeneration = 0;

  // --- useSyncExternalStore contract ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): AutoTranscribeState => this.state;

  // --- Control ---

  start(mediaId: number): void {
    if (this.running) return;
    this.state = { ...INITIAL_STATE, phase: 'syncing' };
    this.emit();
    this.installStatusListener();
    this.runPipeline(mediaId);
  }

  stop(): void {
    this.ac?.abort(new DOMException('User cancelled', 'AbortError'));
  }

  dispose(): void {
    this.stop();
    this.clearCountdown();
    this.uninstallStatusListener();
    this.listeners.clear();
  }

  // --- Preview query (called by hook when idle + mediaId available) ---

  async queryPreview(mediaId: number): Promise<void> {
    if (this.running) return;
    const gen = ++this.previewGeneration;

    try {
      const preview = await getPendingPreview(mediaId);
      if (gen !== this.previewGeneration) return;
      this.patch({ previewVideo: preview.video, pendingCount: preview.pendingCount });
    } catch {
      // DB not ready
    }
  }

  // --- Private: state management ---

  private patch(p: Partial<AutoTranscribeState>): void {
    this.state = { ...this.state, ...p };
    this.emit();
  }

  private patchStats(p: Partial<AutoTranscribeStats>): void {
    this.state = { ...this.state, stats: { ...this.state.stats, ...p } };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  // --- Private: countdown ---

  private startCountdown(): void {
    this.clearCountdown();
    this.countdownTimer = setInterval(() => {
      const next = this.state.waitSeconds - 1;
      if (next <= 0) {
        this.clearCountdown();
        this.patch({ waitSeconds: 0 });
      } else {
        this.patch({ waitSeconds: next });
      }
    }, 1000);
  }

  private clearCountdown(): void {
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
  }

  private async waitWithCountdown(
    ms: number,
    phase: AutoTranscribePhase,
    signal: AbortSignal,
  ): Promise<void> {
    this.patch({ phase, waitSeconds: Math.ceil(ms / 1000) });
    this.startCountdown();
    try {
      await sleep(ms, signal);
    } finally {
      this.clearCountdown();
    }
  }

  // --- Private: TRANSCRIBE_STATUS listener ---

  private installStatusListener(): void {
    this.uninstallStatusListener();
    this.statusCleanup = createStatusListener(
      () => this.state.currentVideoBvid,
      ({ progress, stage }) => {
        if (!this.running) return;
        this.patch({ videoProgress: progress, videoStage: stage });
      },
    );
  }

  private uninstallStatusListener(): void {
    if (this.statusCleanup) {
      this.statusCleanup();
      this.statusCleanup = null;
    }
  }

  // --- Core pipeline ---

  private async runPipeline(targetMediaId: number): Promise<void> {
    const ac = new AbortController();
    this.ac = ac;
    this.running = true;
    const { signal } = ac;

    const stats: AutoTranscribeStats = { cc: 0, asr: 0, skipped: 0, remaining: 0 };

    try {
      await checkAuth();

      const asrConfig = await getAsrSettings();
      const hasAsrKey = Boolean(asrConfig.apiKey);

      const firstResult = await fetchAndSyncVideos(targetMediaId, 1);
      signal.throwIfAborted();
      const totalPages = firstResult.totalPages;

      let processedIndex = 0;
      this.patch({ totalPages, totalVideos: firstResult.mediaCount, currentPage: 0 });

      for (let page = 1; page <= totalPages; page++) {
        signal.throwIfAborted();

        // --- Sync phase ---
        this.patch({ phase: 'syncing', currentPage: page });

        const pageResult = page === 1 ? firstResult : await fetchAndSyncVideos(targetMediaId, page);
        signal.throwIfAborted();
        const videos = pageResult.videos;

        const pageBvids = videos
          .filter((v) => v.attr !== 9 && v.bvid)
          .map((v) => v.bvid);

        const pendingBvids = await getPendingBvids(pageBvids);

        stats.skipped += videos.filter((v) => v.attr === 9).length;
        stats.cc += pageBvids.length - pendingBvids.length;
        stats.remaining = pendingBvids.length + (totalPages - page) * PAGE_SIZE;
        this.patchStats({ ...stats });

        // --- Transcribe phase ---
        this.patch({ phase: 'transcribing' });

        for (const bvid of pendingBvids) {
          signal.throwIfAborted();

          const video = videos.find((v) => v.bvid === bvid);
          const title = video?.title ?? bvid;
          processedIndex++;

          this.patch({
            currentVideoTitle: title,
            currentVideoBvid: bvid,
            currentVideo: video
              ? {
                  cover: normalizeCover(video.cover),
                  title: video.title,
                  upper: video.upper.name,
                  duration: video.duration,
                }
              : null,
            currentIndex: processedIndex,
            videoProgress: 0,
            videoStage: 'start',
          });

          try {
            const response = await transcribeAndPersist(bvid, title);

            if (response.success) {
              if (response.data.source === 'official') stats.cc++;
              else stats.asr++;
              stats.remaining = Math.max(0, stats.remaining - 1);
              this.patchStats({ ...stats });

              const delayMs = response.data.source === 'official'
                ? randomDelay(5, 10)
                : randomDelay(10, 15);
              await this.waitWithCountdown(delayMs, 'waiting', signal);
            } else {
              const errorCode = response.error.code;

              if (errorCode === 'ASR_RATE_LIMIT') {
                await this.waitWithCountdown(RATE_LIMIT_PAUSE_MS, 'paused', signal);
                const retryRes = await transcribeAndPersist(bvid, title);
                if (retryRes.success) {
                  if (retryRes.data.source === 'official') stats.cc++;
                  else stats.asr++;
                } else {
                  stats.skipped++;
                }
              } else if (errorCode === 'ASR_INVALID_KEY' && !hasAsrKey) {
                stats.skipped++;
              } else {
                stats.skipped++;
                await markVideoError(bvid);
              }

              stats.remaining = Math.max(0, stats.remaining - 1);
              this.patchStats({ ...stats });

              await this.waitWithCountdown(3000, 'waiting', signal);
            }
          } catch {
            stats.skipped++;
            stats.remaining = Math.max(0, stats.remaining - 1);
            this.patchStats({ ...stats });
          }
        }

        if (page < totalPages) {
          await this.waitWithCountdown(randomDelay(5, 10), 'waiting', signal);
        }
      }

      stats.remaining = 0;
      this.patchStats({ ...stats });
      this.patch({
        phase: 'done',
        currentVideoTitle: '',
        currentVideoBvid: '',
        currentVideo: null,
        videoProgress: 0,
        videoStage: '',
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || signal.aborted) {
        this.patch({ phase: 'cancelled' });
      } else {
        console.error('[auto-transcribe] Pipeline error:', err);
        this.patch({ phase: 'cancelled' });
      }
    } finally {
      this.running = false;
      this.ac = null;
      this.uninstallStatusListener();
    }
  }
}
