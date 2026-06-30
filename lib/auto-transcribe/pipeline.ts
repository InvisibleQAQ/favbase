import type {
  AutoTranscribeAdapter,
  AutoTranscribePhase,
  AutoTranscribeState,
  AutoTranscribeStats,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_STATE: AutoTranscribeState = {
  phase: 'idle',
  currentPage: 0,
  totalPages: 0,
  currentVideoTitle: '',
  currentVideoId: '',
  currentVideo: null,
  totalVideos: 0,
  currentIndex: 0,
  videoProgress: 0,
  videoStage: '',
  waitSeconds: 0,
  stats: { existing: 0, cc: 0, asr: 0, skipped: 0, remaining: 0 },
  previewVideo: null,
  pendingCount: null,
  previewLoading: true,
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
  private readonly adapter: AutoTranscribeAdapter;
  private state: AutoTranscribeState = { ...INITIAL_STATE };
  private listeners = new Set<() => void>();
  private ac: AbortController | null = null;
  private running = false;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private statusCleanup: (() => void) | null = null;
  private previewGeneration = 0;

  constructor(adapter: AutoTranscribeAdapter) {
    this.adapter = adapter;
  }

  // --- useSyncExternalStore contract ---

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): AutoTranscribeState => this.state;

  // --- Control ---

  start(collectionId: string): void {
    if (this.running) return;
    this.state = { ...INITIAL_STATE, phase: 'syncing', previewLoading: false };
    this.emit();
    this.installStatusListener();
    this.runPipeline(collectionId);
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

  // --- Preview query (called by hook when idle + collectionId available) ---

  async queryPreview(collectionId: string): Promise<void> {
    if (this.running) return;
    const gen = ++this.previewGeneration;
    this.patch({ previewLoading: true });
    await this.queryPreviewAttempt(collectionId, gen, 0);
  }

  private async queryPreviewAttempt(collectionId: string, gen: number, attempt: number): Promise<void> {
    try {
      const preview = await this.adapter.getPreview(collectionId);
      if (gen !== this.previewGeneration) return;
      if (preview.pendingCount === null && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2000));
        if (gen !== this.previewGeneration) return;
        return this.queryPreviewAttempt(collectionId, gen, attempt + 1);
      }
      this.patch({ previewVideo: preview.video, pendingCount: preview.pendingCount, previewLoading: false });
    } catch {
      if (gen !== this.previewGeneration) return;
      this.patch({ previewLoading: false });
    }
  }

  // --- Private: state management ---

  private patch(p: Partial<AutoTranscribeState>): void {
    this.state = { ...this.state, ...p };
    this.emit();
  }

  private patchStats(p: Partial<AutoTranscribeStats>): void {
    const nextStats = { ...this.state.stats, ...p };
    this.state = {
      ...this.state,
      stats: nextStats,
      currentIndex: nextStats.existing + nextStats.cc + nextStats.asr + nextStats.skipped,
    };
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
    this.statusCleanup = this.adapter.createStatusListener(
      () => this.state.currentVideoId,
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

  private async runPipeline(collectionId: string): Promise<void> {
    const ac = new AbortController();
    this.ac = ac;
    this.running = true;
    const { signal } = ac;

    const stats: AutoTranscribeStats = { existing: 0, cc: 0, asr: 0, skipped: 0, remaining: 0 };

    try {
      await this.adapter.checkAuth();

      const hasAsrKey = await this.adapter.hasAsrKey();

      const firstResult = await this.adapter.fetchPage(collectionId, 1);
      signal.throwIfAborted();
      const totalPages = firstResult.totalPages;

      this.patch({ totalPages, totalVideos: firstResult.totalCount, currentPage: 0 });

      for (let page = 1; page <= totalPages; page++) {
        signal.throwIfAborted();

        // --- Sync phase ---
        this.patch({ phase: 'syncing', currentPage: page });

        const pageResult = page === 1 ? firstResult : await this.adapter.fetchPage(collectionId, page);
        signal.throwIfAborted();
        const videos = pageResult.videos;

        const validVideos = videos.filter((v) => !v.isInvalid);
        const validIds = validVideos.map((v) => v.videoId);

        const pendingIds = await this.adapter.getPendingIds(validIds);

        stats.skipped += videos.length - validVideos.length;
        stats.existing += validIds.length - pendingIds.length;
        stats.remaining = pendingIds.length + (totalPages - page) * PAGE_SIZE;
        this.patchStats({ ...stats });

        // --- Transcribe phase ---
        this.patch({ phase: 'transcribing' });

        for (const videoId of pendingIds) {
          signal.throwIfAborted();

          const video = validVideos.find((v) => v.videoId === videoId);
          const title = video?.title ?? videoId;

          this.patch({
            currentVideoTitle: title,
            currentVideoId: videoId,
            currentVideo: video
              ? { cover: video.cover, title: video.title, author: video.author, duration: video.duration }
              : null,
            videoProgress: 0,
            videoStage: 'start',
          });

          try {
            const response = await this.adapter.transcribe(videoId, title);

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
                const retryRes = await this.adapter.transcribe(videoId, title);
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
                await this.adapter.markError(videoId);
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
        currentVideoId: '',
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
