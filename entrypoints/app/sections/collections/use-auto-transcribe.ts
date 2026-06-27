import { useCallback, useEffect, useRef, useState } from 'react';
import { getBiliAuth, fetchFavVideos } from '@/lib/bilibili/bilibili-api';
import { syncFavVideosToDb } from '@/lib/bilibili/videos-sync';
import { persistSubtitleContent } from '@/lib/bilibili/content-sync';
import { resolveAsrConfig, settingsStorage } from '@/lib/storage';
import { getDb } from '@/lib/database';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { sources } from '@/lib/database/entities/sources';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import type { BiliFavVideo } from '@/lib/bilibili/types';
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

export interface UseAutoTranscribeReturn {
  state: AutoTranscribeState;
  running: boolean;
  start: () => void;
  stop: () => void;
}

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
// Hook
// ---------------------------------------------------------------------------

export function useAutoTranscribe(mediaId: number | undefined): UseAutoTranscribeReturn {
  const [state, setState] = useState<AutoTranscribeState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const runningRef = useRef(false);

  const patch = useCallback((p: Partial<AutoTranscribeState>) => {
    setState((prev) => ({ ...prev, ...p }));
  }, []);

  const patchStats = useCallback((p: Partial<AutoTranscribeStats>) => {
    setState((prev) => ({
      ...prev,
      stats: { ...prev.stats, ...p },
    }));
  }, []);

  // Countdown ticker for wait/pause phases
  useEffect(() => {
    if (state.waitSeconds <= 0) return;
    const timer = setInterval(() => {
      setState((prev) => {
        const next = prev.waitSeconds - 1;
        return { ...prev, waitSeconds: Math.max(0, next) };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state.waitSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Query first pending video for preview when idle
  useEffect(() => {
    if (!mediaId || runningRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const db = getDb();

        // Find sourceId for this mediaId
        const sourceRows = await db
          .select({ id: sources.id })
          .from(sources)
          .where(and(eq(sources.platform, 'bilibili'), eq(sources.platformSourceId, String(mediaId))))
          .limit(1);

        if (cancelled || sourceRows.length === 0) {
          if (!cancelled) patch({ previewVideo: null, pendingCount: 0 });
          return;
        }

        const sourceId = sourceRows[0].id;

        // Query first pending video in this folder (JOIN through item_sources)
        const pendingRows = await db
          .select({
            title: items.title,
            authorName: items.authorName,
            platformMeta: items.platformMeta,
          })
          .from(items)
          .innerJoin(itemSources, eq(items.id, itemSources.itemId))
          .where(
            and(
              eq(itemSources.sourceId, sourceId),
              eq(items.platform, 'bilibili'),
              eq(items.contentState, 'pending'),
            ),
          )
          .orderBy(desc(items.createdAt))
          .limit(1);

        // Count total pending in this folder
        const countRows = await db
          .select({ count: sql<number>`count(*)::int` })
          .from(items)
          .innerJoin(itemSources, eq(items.id, itemSources.itemId))
          .where(
            and(
              eq(itemSources.sourceId, sourceId),
              eq(items.platform, 'bilibili'),
              eq(items.contentState, 'pending'),
            ),
          );

        if (cancelled) return;

        const pendingCount = countRows[0]?.count ?? 0;

        if (pendingRows.length > 0) {
          const row = pendingRows[0];
          const meta = row.platformMeta as Record<string, unknown> | null;
          let cover = (meta?.cover as string) ?? '';
          if (cover.startsWith('//')) cover = `https:${cover}`;
          const duration = typeof meta?.duration === 'number' ? meta.duration : 0;

          patch({
            previewVideo: {
              cover,
              title: row.title,
              upper: row.authorName,
              duration,
            },
            pendingCount,
          });
        } else {
          patch({ previewVideo: null, pendingCount });
        }
      } catch {
        // DB not ready — silently ignore
      }
    })();

    return () => { cancelled = true; };
  }, [mediaId, patch, state.phase]); // Re-query when phase changes (e.g., done → idle after restart)

  // Listen for per-video progress from Background
  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as TranscribeStatusPush;
      if (m?.type !== 'TRANSCRIBE_STATUS') return;
      if (!runningRef.current) return;
      setState((prev) => {
        if (m.bvid.toLowerCase() !== prev.currentVideoBvid.toLowerCase()) return prev;
        return {
          ...prev,
          videoProgress: m.progress,
          videoStage: m.stage,
        };
      });
    };
    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, []);

  // -------------------------------------------------------------------------
  // Core pipeline — runs as a long-lived async function
  // -------------------------------------------------------------------------
  const runPipeline = useCallback(async (targetMediaId: number) => {
    const ac = new AbortController();
    abortRef.current = ac;
    runningRef.current = true;
    const { signal } = ac;

    const stats: AutoTranscribeStats = { cc: 0, asr: 0, skipped: 0, remaining: 0 };

    const syncStats = () => patchStats({ ...stats });

    try {
      // Auth
      const auth = await getBiliAuth();
      if (!auth) throw new Error('Not logged in');

      // Resolve ASR availability
      const settings = await settingsStorage.getValue();
      const asrConfig = resolveAsrConfig(settings);
      const hasAsrKey = Boolean(asrConfig.apiKey);

      // Get DB + sourceId
      const db = getDb();
      const sourceRows = await db
        .select({ id: sources.id })
        .from(sources)
        .where(and(eq(sources.platform, 'bilibili'), eq(sources.platformSourceId, String(targetMediaId))))
        .limit(1);

      // Determine total pages from first fetch
      const firstPage = await fetchFavVideos(auth, targetMediaId, 1);
      signal.throwIfAborted();
      const totalCount = firstPage.info.media_count;
      const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

      let processedIndex = 0;

      patch({ totalPages, totalVideos: totalCount, currentPage: 0 });

      // Process all pages
      for (let page = 1; page <= totalPages; page++) {
        signal.throwIfAborted();

        // --- Sync phase ---
        patch({ phase: 'syncing', currentPage: page });

        const pageData = page === 1 ? firstPage : await fetchFavVideos(auth, targetMediaId, page);
        signal.throwIfAborted();
        const videos = pageData.medias ?? [];

        // Sync to DB
        if (videos.length > 0 && sourceRows.length > 0) {
          await syncFavVideosToDb(db, videos, sourceRows[0].id);
        }

        // Query pending bvids for this page
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

        // Count skipped (invalid) videos on this page
        const invalidCount = videos.filter((v) => v.attr === 9).length;
        stats.skipped += invalidCount;

        // Count already-done on this page
        const alreadyDone = pageBvids.length - pendingBvids.length;
        stats.cc += alreadyDone; // approximate — already done could be CC or ASR

        // Calculate remaining across all pages
        // For simplicity: remaining = total pending on this + future pages
        const futurePages = totalPages - page;
        stats.remaining = pendingBvids.length + futurePages * PAGE_SIZE;
        syncStats();

        // --- Transcribe phase ---
        patch({ phase: 'transcribing' });

        for (const bvid of pendingBvids) {
          signal.throwIfAborted();

          const video = videos.find((v) => v.bvid === bvid);
          const title = video?.title ?? bvid;
          processedIndex++;

          patch({
            currentVideoTitle: title,
            currentVideoBvid: bvid,
            currentVideo: video
              ? {
                  cover: video.cover?.startsWith('//')
                    ? `https:${video.cover}`
                    : video.cover,
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
            const response = await browser.runtime.sendMessage({
              type: 'TRANSCRIBE_AUDIO',
              bvid,
              title,
            }) as TranscribeResponse;

            if (response.success) {
              // Persist to PGlite
              try {
                persistSubtitleContent(db, bvid, response.data.rows, response.data.source).catch(() => {});
              } catch { /* DB not ready */ }

              if (response.data.source === 'bilibili') {
                stats.cc++;
              } else {
                stats.asr++;
              }
              stats.remaining = Math.max(0, stats.remaining - 1);
              syncStats();

              // Delay based on source
              const delayMs = response.data.source === 'bilibili'
                ? randomDelay(5, 10)
                : randomDelay(10, 15);
              const delaySec = Math.ceil(delayMs / 1000);
              patch({ phase: 'waiting', waitSeconds: delaySec });
              await sleep(delayMs, signal);
            } else {
              const errorCode = response.error.code;

              if (errorCode === 'ASR_RATE_LIMIT') {
                // Pause 1 minute
                patch({ phase: 'paused', waitSeconds: 60 });
                await sleep(RATE_LIMIT_PAUSE_MS, signal);
                // Retry the same video after pause
                const retryRes = await browser.runtime.sendMessage({
                  type: 'TRANSCRIBE_AUDIO',
                  bvid,
                  title,
                }) as TranscribeResponse;

                if (retryRes.success) {
                  try {
                    persistSubtitleContent(db, bvid, retryRes.data.rows, retryRes.data.source).catch(() => {});
                  } catch { /* */ }
                  if (retryRes.data.source === 'bilibili') stats.cc++;
                  else stats.asr++;
                } else {
                  stats.skipped++;
                }
              } else if (errorCode === 'ASR_INVALID_KEY' && !hasAsrKey) {
                // No ASR key — skip, keep pending
                stats.skipped++;
              } else {
                // Other error — mark as error in DB and skip
                stats.skipped++;
                try {
                  await db
                    .update(items)
                    .set({ contentState: 'error' })
                    .where(
                      and(
                        eq(items.platform, 'bilibili'),
                        eq(items.platformItemId, bvid),
                      ),
                    );
                } catch { /* */ }
              }

              stats.remaining = Math.max(0, stats.remaining - 1);
              syncStats();

              // Brief delay even on skip
              patch({ phase: 'waiting', waitSeconds: 3 });
              await sleep(3000, signal);
            }
          } catch (err) {
            // sendMessage failure — skip
            stats.skipped++;
            stats.remaining = Math.max(0, stats.remaining - 1);
            syncStats();
          }
        }

        // Inter-page delay (except last page)
        if (page < totalPages) {
          const delayMs = randomDelay(5, 10);
          const delaySec = Math.ceil(delayMs / 1000);
          patch({ phase: 'waiting', waitSeconds: delaySec });
          await sleep(delayMs, signal);
        }
      }

      // Done
      stats.remaining = 0;
      syncStats();
      patch({ phase: 'done', currentVideoTitle: '', currentVideoBvid: '', currentVideo: null, videoProgress: 0, videoStage: '' });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError' || signal.aborted) {
        patch({ phase: 'cancelled' });
      } else {
        console.error('[auto-transcribe] Pipeline error:', err);
        patch({ phase: 'cancelled' });
      }
    } finally {
      runningRef.current = false;
      abortRef.current = null;
    }
  }, [patch, patchStats]);

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  const start = useCallback(() => {
    if (runningRef.current || !mediaId) return;
    setState({ ...INITIAL_STATE, phase: 'syncing' });
    runPipeline(mediaId);
  }, [mediaId, runPipeline]);

  const stop = useCallback(() => {
    abortRef.current?.abort(new DOMException('User cancelled', 'AbortError'));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort(new DOMException('Unmount', 'AbortError'));
    };
  }, []);

  return {
    state,
    running: state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'cancelled',
    start,
    stop,
  };
}
