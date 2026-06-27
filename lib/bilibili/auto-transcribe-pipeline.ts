import { getBiliAuth, fetchFavVideos } from './bilibili-api';
import { syncFavVideosToDb } from './videos-sync';
import { persistSubtitleContent } from './content-sync';
import { resolveAsrConfig, settingsStorage } from '@/lib/storage';
import { getDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { sources } from '@/lib/database/entities/sources';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import type { TranscribeResponse, TranscribeStatusPush } from '@/lib/transcription/types';

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

function normalizeCover(cover?: string): string {
  if (!cover) return '';
  return cover.startsWith('//') ? `https:${cover}` : cover;
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
  private statusHandler: ((msg: unknown) => void) | null = null;
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
    this.removeStatusListener();
    this.listeners.clear();
  }

  // --- Preview query (called by hook when idle + mediaId available) ---

  async queryPreview(mediaId: number): Promise<void> {
    if (this.running) return;
    const gen = ++this.previewGeneration;

    try {
      const db = getDb();

      const sourceRows = await db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.platform, 'bilibili'), eq(sources.platformSourceId, String(mediaId))))
        .limit(1);

      if (gen !== this.previewGeneration) return;

      if (sourceRows.length === 0) {
        this.patch({ previewVideo: null, pendingCount: 0 });
        return;
      }

      const sourceId = sourceRows[0].id;
      const pendingFilter = and(
        eq(itemSources.sourceId, sourceId),
        eq(items.platform, 'bilibili'),
        eq(items.contentState, 'pending'),
      );

      const pendingRows = await db
        .select({ title: items.title, authorName: items.authorName, platformMeta: items.platformMeta })
        .from(items)
        .innerJoin(itemSources, eq(items.id, itemSources.itemId))
        .where(pendingFilter)
        .orderBy(desc(items.createdAt))
        .limit(1);

      const countRows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(items)
        .innerJoin(itemSources, eq(items.id, itemSources.itemId))
        .where(pendingFilter);

      if (gen !== this.previewGeneration) return;

      const pendingCount = countRows[0]?.count ?? 0;

      if (pendingRows.length > 0) {
        const row = pendingRows[0];
        const meta = row.platformMeta as Record<string, unknown> | null;
        const duration = typeof meta?.duration === 'number' ? meta.duration : 0;

        this.patch({
          previewVideo: {
            cover: normalizeCover(meta?.cover as string),
            title: row.title,
            upper: row.authorName,
            duration,
          },
          pendingCount,
        });
      } else {
        this.patch({ previewVideo: null, pendingCount });
      }
    } catch {
      // DB not ready
    }
  }

  // --- Seam for #2 reuse: single-video transcribe + DB persist ---

  async transcribeAndPersist(bvid: string, title: string): Promise<TranscribeResponse> {
    const response = await browser.runtime.sendMessage({
      type: 'TRANSCRIBE_AUDIO',
      bvid,
      title,
    }) as TranscribeResponse;

    if (response.success) {
      try {
        const db = getDb();
        persistSubtitleContent(db, bvid, response.data.rows, response.data.source).catch(() => {});
      } catch { /* DB not ready */ }
    }

    return response;
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
    this.removeStatusListener();
    this.statusHandler = (msg: unknown) => {
      const m = msg as TranscribeStatusPush;
      if (m?.type !== 'TRANSCRIBE_STATUS') return;
      if (!this.running) return;
      if (m.bvid.toLowerCase() !== this.state.currentVideoBvid.toLowerCase()) return;
      this.patch({ videoProgress: m.progress, videoStage: m.stage });
    };
    browser.runtime.onMessage.addListener(this.statusHandler);
  }

  private removeStatusListener(): void {
    if (this.statusHandler) {
      browser.runtime.onMessage.removeListener(this.statusHandler);
      this.statusHandler = null;
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
      const auth = await getBiliAuth();
      if (!auth) throw new Error('Not logged in');

      const settings = await settingsStorage.getValue();
      const asrConfig = resolveAsrConfig(settings);
      const hasAsrKey = Boolean(asrConfig.apiKey);

      const db = getDb();
      const sourceRows = await db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.platform, 'bilibili'), eq(sources.platformSourceId, String(targetMediaId))))
        .limit(1);

      const firstPage = await fetchFavVideos(auth, targetMediaId, 1);
      signal.throwIfAborted();
      const totalCount = firstPage.info.media_count;
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

      let processedIndex = 0;
      this.patch({ totalPages, totalVideos: totalCount, currentPage: 0 });

      for (let page = 1; page <= totalPages; page++) {
        signal.throwIfAborted();

        // --- Sync phase ---
        this.patch({ phase: 'syncing', currentPage: page });

        const pageData = page === 1 ? firstPage : await fetchFavVideos(auth, targetMediaId, page);
        signal.throwIfAborted();
        const videos = pageData.medias ?? [];

        if (videos.length > 0 && sourceRows.length > 0) {
          await syncFavVideosToDb(db, videos, sourceRows[0].id);
        }

        const pageBvids = videos
          .filter((v) => v.attr !== 9 && v.bvid)
          .map((v) => v.bvid);

        let pendingBvids: string[] = [];
        if (pageBvids.length > 0) {
          const rows = await db
            .select({ platformItemId: items.platformItemId })
            .from(items)
            .where(
              and(
                eq(items.platform, 'bilibili'),
                inArray(items.platformItemId, pageBvids),
                eq(items.contentState, 'pending'),
              ),
            );
          pendingBvids = rows.map((r) => r.platformItemId);
        }

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
            const response = await this.transcribeAndPersist(bvid, title);

            if (response.success) {
              if (response.data.source === 'bilibili') stats.cc++;
              else stats.asr++;
              stats.remaining = Math.max(0, stats.remaining - 1);
              this.patchStats({ ...stats });

              const delayMs = response.data.source === 'bilibili'
                ? randomDelay(5, 10)
                : randomDelay(10, 15);
              await this.waitWithCountdown(delayMs, 'waiting', signal);
            } else {
              const errorCode = response.error.code;

              if (errorCode === 'ASR_RATE_LIMIT') {
                await this.waitWithCountdown(RATE_LIMIT_PAUSE_MS, 'paused', signal);
                const retryRes = await this.transcribeAndPersist(bvid, title);
                if (retryRes.success) {
                  if (retryRes.data.source === 'bilibili') stats.cc++;
                  else stats.asr++;
                } else {
                  stats.skipped++;
                }
              } else if (errorCode === 'ASR_INVALID_KEY' && !hasAsrKey) {
                stats.skipped++;
              } else {
                stats.skipped++;
                try {
                  await db
                    .update(items)
                    .set({ contentState: 'error' })
                    .where(
                      and(eq(items.platform, 'bilibili'), eq(items.platformItemId, bvid)),
                    );
                } catch { /* */ }
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
      this.removeStatusListener();
    }
  }
}
