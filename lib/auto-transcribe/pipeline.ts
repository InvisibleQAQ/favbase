import type {
  AutoTranscribeAdapter,
  AutoTranscribePhase,
  AutoTranscribeQuotaPause,
  AutoTranscribeState,
  AutoTranscribeStats,
} from './types';
import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import type { TranscribeErrorInfo } from '@/lib/transcription/types';

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
  quotaResetAt: null,
  stats: { existing: 0, cc: 0, asr: 0, skipped: 0, remaining: 0 },
  previewVideo: null,
  pendingCount: null,
  previewLoading: true,
};

const PAGE_SIZE = 20;
const DEFAULT_RATE_LIMIT_PAUSE_SECONDS = 60;

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
  private startPending = false;
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

  /** True while a run is executing or a start is resolving its quota guard. */
  isActive(): boolean {
    return this.running || this.startPending;
  }

  /**
   * Start one batch run. Resolves when the run finishes (never rejects — the
   * pipeline reports failures through its phase). The optional cooperative
   * checkpoint is awaited before any network work and before claiming each
   * video, so a paused job blocks between items without cancelling the run.
   */
  async start(collectionId: string, control?: CooperativeCheckpoint): Promise<void> {
    if (this.running || this.startPending) return;
    this.startPending = true;
    try {
      // Read the DURABLE quota guard before deciding: a fresh instance's
      // in-memory quotaResetAt stays null until an async preview lands, and
      // automatic starts (post-fetch chaining, daily auto-sync) hit exactly
      // that window. The in-memory mirror is only the fallback when the read
      // fails.
      let persisted: AutoTranscribeQuotaPause | null = null;
      try {
        persisted = await this.adapter.getQuotaPause();
      } catch (error) {
        console.error('[auto-transcribe] Failed to read quota pause:', error);
      }
      if (this.running) return;
      const resetAt = persisted?.resetAt ?? this.state.quotaResetAt;
      if (resetAt !== null && resetAt > Date.now()) {
        // Guard still active — surface it (an idle fresh instance may not have
        // loaded it yet) and skip silently. Recovery is the next automatic
        // start after the reset (daily auto-sync re-evaluates every day).
        this.patch({
          phase: 'quota_paused',
          quotaResetAt: resetAt,
          waitSeconds: Math.max(0, Math.ceil((resetAt - Date.now()) / 1000)),
          previewLoading: false,
        });
        this.startCountdown();
        return;
      }
      if (persisted !== null || this.state.quotaResetAt !== null) {
        try {
          await this.adapter.setQuotaPause(null);
        } catch (error) {
          console.error('[auto-transcribe] Failed to clear quota pause:', error);
        }
      }
      this.state = { ...INITIAL_STATE, phase: 'syncing', previewLoading: false };
      this.emit();
      this.installStatusListener();
      await this.runPipeline(collectionId, control);
    } finally {
      this.startPending = false;
    }
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
      const quotaPause = await this.adapter.getQuotaPause();
      if (gen !== this.previewGeneration) return;
      if (quotaPause && quotaPause.resetAt > Date.now()) {
        this.patch({
          phase: 'quota_paused',
          quotaResetAt: quotaPause.resetAt,
          waitSeconds: Math.ceil((quotaPause.resetAt - Date.now()) / 1000),
          previewLoading: false,
        });
        this.startCountdown();
        return;
      }
      if (quotaPause) await this.adapter.setQuotaPause(null);
      if (gen !== this.previewGeneration) return;

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
      const next = this.state.phase === 'quota_paused' && this.state.quotaResetAt !== null
        ? Math.ceil((this.state.quotaResetAt - Date.now()) / 1000)
        : this.state.waitSeconds - 1;
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

  private async pauseForQuota(error: TranscribeErrorInfo): Promise<boolean> {
    if (error.code !== 'ASR_QUOTA_EXCEEDED') return false;

    const resetAt = error.resetAt ?? null;
    if (resetAt !== null && error.providerId) {
      try {
        await this.adapter.setQuotaPause({ providerId: error.providerId, resetAt });
      } catch (storageError) {
        console.error('[auto-transcribe] Failed to persist quota pause:', storageError);
      }
    }

    const waitSeconds = resetAt === null
      ? error.retryAfter ?? 0
      : Math.max(0, Math.ceil((resetAt - Date.now()) / 1000));
    this.patch({
      phase: 'quota_paused',
      quotaResetAt: resetAt,
      waitSeconds,
    });
    if (waitSeconds > 0) this.startCountdown();
    return true;
  }

  // --- Core pipeline ---

  private async runPipeline(
    collectionId: string,
    control?: CooperativeCheckpoint,
  ): Promise<void> {
    const ac = new AbortController();
    this.ac = ac;
    this.running = true;
    const { signal } = ac;

    const stats: AutoTranscribeStats = { existing: 0, cc: 0, asr: 0, skipped: 0, remaining: 0 };

    try {
      // Library-gate seam: a born-paused run parks HERE, before any network.
      await control?.checkpoint();
      await this.adapter.checkAuth();

      const hasAsrKey = await this.adapter.hasAsrKey();

      const firstResult = await this.adapter.fetchPage(collectionId, 1);
      signal.throwIfAborted();
      const totalPages = firstResult.totalPages;

      this.patch({ totalPages, totalVideos: firstResult.totalCount, currentPage: 0 });

      for (let page = 1; page <= totalPages; page++) {
        signal.throwIfAborted();
        await control?.checkpoint();

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
          // Cooperative pause boundary: block before claiming the next video.
          await control?.checkpoint();

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
            const response = await this.adapter.transcribe(videoId, title, () =>
              this.patch({ videoStage: 'indexing', videoProgress: 100 }),
            );

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

              if (await this.pauseForQuota(response.error)) return;

              if (errorCode === 'ASR_RATE_LIMIT') {
                const retryDelayMs = (response.error.retryAfter ?? DEFAULT_RATE_LIMIT_PAUSE_SECONDS) * 1000;
                await this.waitWithCountdown(retryDelayMs, 'paused', signal);
                const retryRes = await this.adapter.transcribe(videoId, title, () =>
                  this.patch({ videoStage: 'indexing', videoProgress: 100 }),
                );
                if (retryRes.success) {
                  if (retryRes.data.source === 'official') stats.cc++;
                  else stats.asr++;
                } else {
                  if (await this.pauseForQuota(retryRes.error)) return;
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
