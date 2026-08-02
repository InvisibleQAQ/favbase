import type {
  AutoTranscribeAdapter,
  AutoTranscribePhase,
  AutoTranscribeQuotaPause,
  AutoTranscribeState,
  AutoTranscribeStats,
  AutoTranscribeVideo,
} from './types';
import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import type { TranscribeErrorInfo } from '@/lib/transcription/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_STATE: AutoTranscribeState = {
  phase: 'idle',
  asrBlocked: false,
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
};

const DEFAULT_RATE_LIMIT_PAUSE_SECONDS = 60;

export interface AutoTranscribeSession {
  append(videos: readonly AutoTranscribeVideo[]): void;
  close(): void;
  run(control?: CooperativeCheckpoint): Promise<void>;
}

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
  private sessionActive = false;
  private closeActiveSession: (() => void) | null = null;

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

  /** True while a producer session exists, including before its runner starts. */
  isActive(): boolean {
    return this.running || this.sessionActive;
  }

  createSession(): AutoTranscribeSession {
    if (this.isActive()) throw new Error('Auto-transcribe session already active');

    const queue: AutoTranscribeVideo[] = [];
    const blockedAsr: AutoTranscribeVideo[] = [];
    const seen = new Set<string>();
    let closed = false;
    let started = false;
    let wake: (() => void) | null = null;
    let asrWait: Promise<void> | null = null;
    let asrWaitError: unknown = null;
    this.sessionActive = true;
    this.state = { ...INITIAL_STATE };
    this.emit();

    const close = (): void => {
      if (closed) return;
      closed = true;
      wake?.();
      wake = null;
    };
    this.closeActiveSession = close;

    const watchForAsrConfiguration = (): void => {
      if (asrWait) return;

      asrWait = this.adapter.waitForAsrKey().then(
        () => {
          asrWait = null;
          asrWaitError = null;
          queue.unshift(...blockedAsr.splice(0));
          this.patch({ asrBlocked: false, phase: 'transcribing' });
          wake?.();
          wake = null;
        },
        (error: unknown) => {
          asrWait = null;
          asrWaitError = error;
          wake?.();
          wake = null;
        },
      );
    };

    const waitForItem = async (): Promise<boolean> => {
      if (
        queue.length === 0
        && blockedAsr.length > 0
        && this.state.phase !== 'configuration_required'
      ) {
        this.patch({ phase: 'configuration_required' });
      }
      while (queue.length === 0 && (!closed || blockedAsr.length > 0)) {
        if (asrWaitError) throw asrWaitError;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = null;
      }
      if (asrWaitError) throw asrWaitError;
      return queue.length > 0;
    };

    return {
      append: (videos) => {
        if (closed) throw new Error('Cannot append to a closed auto-transcribe session');
        const accepted = videos.filter((video) => {
          const id = video.videoId.toLowerCase();
          if (!id || seen.has(id)) return false;
          seen.add(id);
          return true;
        });
        if (accepted.length === 0) return;
        queue.push(...accepted);
        const stats = {
          ...this.state.stats,
          remaining: this.state.stats.remaining + accepted.length,
        };
        this.patch({ totalVideos: this.state.totalVideos + accepted.length, stats });
        wake?.();
        wake = null;
      },
      close,
      run: async (control) => {
        if (started) throw new Error('Auto-transcribe session already started');
        started = true;
        const ac = new AbortController();
        this.ac = ac;
        this.running = true;
        this.installStatusListener();

        try {
          // A born-paused Library Gate must stop the runner before quota
          // storage or any inbox item is touched.
          await control?.checkpoint();
          let persisted: AutoTranscribeQuotaPause | null = null;
          try {
            persisted = await this.adapter.getQuotaPause();
          } catch (error) {
            console.error('[auto-transcribe] Failed to read quota pause:', error);
          }
          const resetAt = persisted?.resetAt ?? null;
          if (resetAt !== null && resetAt > Date.now()) {
            await this.waitForQuotaReset(resetAt, ac.signal);
          }
          if (persisted !== null) {
            await this.clearQuotaPause();
          }
          this.patch({ phase: 'transcribing' });

          while (true) {
            if (!(await waitForItem())) break;
            ac.signal.throwIfAborted();
            await control?.checkpoint();
            ac.signal.throwIfAborted();
            const item = queue.shift();
            if (!item) continue;
            this.patch({
              phase: 'transcribing',
              currentVideoTitle: item.title,
              currentVideoId: item.videoId,
              currentVideo: {
                cover: item.cover,
                title: item.title,
                author: item.author,
                duration: item.duration,
              },
              videoProgress: 0,
              videoStage: 'start',
            });

            try {
              let response: Awaited<ReturnType<AutoTranscribeAdapter['transcribe']>>;
              let parkedForAsr = false;
              let rateLimitRetried = false;
              while (true) {
                response = await this.adapter.transcribe(
                  item.videoId,
                  item.title,
                  () => this.patch({ videoStage: 'indexing', videoProgress: 100 }),
                );
                if (
                  !response.success
                  && response.error.code === 'ASR_INVALID_KEY'
                  && !(await this.adapter.hasAsrKey())
                ) {
                  blockedAsr.push(item);
                  this.patch({
                    phase: queue.length > 0 ? 'transcribing' : 'configuration_required',
                    asrBlocked: true,
                  });
                  watchForAsrConfiguration();
                  parkedForAsr = true;
                  break;
                }
                if (
                  !response.success
                  && response.error.code === 'ASR_RATE_LIMIT'
                  && !rateLimitRetried
                ) {
                  rateLimitRetried = true;
                  const retryDelayMs = (
                    response.error.retryAfter ?? DEFAULT_RATE_LIMIT_PAUSE_SECONDS
                  ) * 1000;
                  await this.waitWithCountdown(retryDelayMs, 'paused', ac.signal);
                  this.patch({ phase: 'transcribing', videoProgress: 0, videoStage: 'start' });
                  continue;
                }
                if (!response.success && response.error.code === 'ASR_QUOTA_EXCEEDED') {
                  const resumable = await this.waitForQuota(response.error, ac.signal);
                  if (!resumable) return;
                  await control?.checkpoint();
                  this.patch({ phase: 'transcribing', videoProgress: 0, videoStage: 'start' });
                  continue;
                }
                break;
              }
              if (parkedForAsr) continue;
              if (response.success) {
                const stats = { ...this.state.stats };
                if (response.data.source === 'official') stats.cc += 1;
                else stats.asr += 1;
                stats.remaining = Math.max(0, stats.remaining - 1);
                this.patchStats(stats);

                const delayMs = response.data.source === 'official'
                  ? randomDelay(5, 10)
                  : randomDelay(10, 15);
                await this.waitWithCountdown(delayMs, 'waiting', ac.signal);
              } else {
                await this.adapter.markError(item.videoId);
                this.patchStats({
                  skipped: this.state.stats.skipped + 1,
                  remaining: Math.max(0, this.state.stats.remaining - 1),
                });
              }
            } catch (error) {
              if ((error as Error)?.name === 'AbortError' || ac.signal.aborted) throw error;
              console.error(`[auto-transcribe] Item ${item.videoId} failed:`, error);
              try {
                await this.adapter.markError(item.videoId);
              } catch (markError) {
                console.error(`[auto-transcribe] Failed to mark ${item.videoId}:`, markError);
              }
              this.patchStats({
                skipped: this.state.stats.skipped + 1,
                remaining: Math.max(0, this.state.stats.remaining - 1),
              });
            }
          }

          this.patch({
            phase: 'done',
            asrBlocked: false,
            currentVideoTitle: '',
            currentVideoId: '',
            currentVideo: null,
            videoProgress: 0,
            videoStage: '',
          });
        } catch (error) {
          if ((error as Error)?.name !== 'AbortError' && !ac.signal.aborted) {
            console.error('[auto-transcribe] Pipeline error:', error);
          }
          this.patch({ phase: 'cancelled', asrBlocked: false });
        } finally {
          this.running = false;
          this.sessionActive = false;
          this.closeActiveSession = null;
          this.ac = null;
          this.uninstallStatusListener();
        }
      },
    };
  }

  stop(): void {
    this.ac?.abort(new DOMException('User cancelled', 'AbortError'));
  }

  dispose(): void {
    this.closeActiveSession?.();
    this.stop();
    this.clearCountdown();
    this.uninstallStatusListener();
    this.listeners.clear();
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

  private async waitForQuotaReset(resetAt: number, signal: AbortSignal): Promise<void> {
    const remainingMs = Math.max(0, resetAt - Date.now());
    this.patch({ quotaResetAt: resetAt });
    if (remainingMs > 0) {
      await this.waitWithCountdown(remainingMs, 'quota_paused', signal);
    }
    this.patch({ quotaResetAt: null, waitSeconds: 0 });
  }

  private async clearQuotaPause(): Promise<void> {
    try {
      await this.adapter.setQuotaPause(null);
    } catch (error) {
      console.error('[auto-transcribe] Failed to clear quota pause:', error);
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

  private async waitForQuota(
    error: TranscribeErrorInfo,
    signal: AbortSignal,
  ): Promise<boolean> {
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
    if (resetAt !== null) {
      await this.waitForQuotaReset(resetAt, signal);
      await this.clearQuotaPause();
      return true;
    }
    if (waitSeconds > 0) {
      await this.waitWithCountdown(waitSeconds * 1000, 'quota_paused', signal);
      this.patch({ quotaResetAt: null, waitSeconds: 0 });
      return true;
    }
    return false;
  }

}
