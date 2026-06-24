import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TranscribeResponse,
  TranscribeStatusPush,
  TranscribeStage,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import {
  getBiliAuth,
  fetchCidByPageList,
  fetchSubtitle,
} from '@/lib/bilibili/bilibili-api';
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
import { persistSubtitleContent } from '@/lib/bilibili/content-sync';
import { getDb } from '@/lib/database';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentStatus = 'unknown' | 'checking' | 'has_bilibili' | 'has_groq' | 'none';

export interface VideoTranscribeState {
  contentStatus: ContentStatus;
  transcribing: boolean;
  progress: number;
  stage: TranscribeStage | '';
  stageParams?: Record<string, string | number>;
  error: TranscribeErrorInfo | null;
  retryCountdown: number;
}

export interface UseVideoTranscribeReturn {
  getState: (bvid: string) => VideoTranscribeState;
  startTranscribe: (video: BiliFavVideo) => void;
  cancelTranscribe: () => void;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVideoTranscribe(
  videos: BiliFavVideo[],
  hasAsrApiKey: boolean,
): UseVideoTranscribeReturn {
  const [stateMap, setStateMap] = useState<Map<string, VideoTranscribeState>>(new Map());
  const [activeBvid, setActiveBvid] = useState<string | null>(null);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const generationRef = useRef(0);

  const updateVideo = useCallback((bvid: string, patch: Partial<VideoTranscribeState>) => {
    setStateMap((prev) => {
      const next = new Map(prev);
      const current = next.get(bvid) ?? { ...DEFAULT_STATE };
      next.set(bvid, { ...current, ...patch });
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Batch preload cache status when videos change (page load / pagination)
  // -------------------------------------------------------------------------
  useEffect(() => {
    generationRef.current++;
    const gen = generationRef.current;

    const validVideos = videos.filter((v) => v.attr !== 9 && v.bvid);
    if (validVideos.length === 0) return;

    const bvids = validVideos.map((v) => v.bvid);

    setStateMap((prev) => {
      const next = new Map(prev);
      for (const bvid of bvids) {
        if (!next.has(bvid)) {
          next.set(bvid, { ...DEFAULT_STATE, contentStatus: 'checking' });
        }
      }
      return next;
    });

    Promise.all(
      bvids.map((bvid) =>
        browser.runtime
          .sendMessage({ type: 'GET_VIDEO_CACHE', bvid })
          .then((entry: unknown) => ({ bvid, entry: entry as { rows: unknown[]; source: 'bilibili' | 'groq' } | null }))
          .catch(() => ({ bvid, entry: null })),
      ),
    ).then((results) => {
      if (gen !== generationRef.current) return;

      setStateMap((prev) => {
        const next = new Map(prev);
        for (const { bvid, entry } of results) {
          const current = next.get(bvid);
          if (current?.transcribing) continue;

          const contentStatus: ContentStatus =
            entry && entry.rows?.length > 0
              ? entry.source === 'bilibili'
                ? 'has_bilibili'
                : 'has_groq'
              : 'none';

          next.set(bvid, { ...(current ?? { ...DEFAULT_STATE }), contentStatus });
        }
        return next;
      });
    });
  }, [videos]);

  // -------------------------------------------------------------------------
  // Listen for TRANSCRIBE_STATUS progress pushes from Background
  // -------------------------------------------------------------------------
  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as TranscribeStatusPush;
      if (m?.type !== 'TRANSCRIBE_STATUS') return;
      if (!m.bvid || m.bvid.toLowerCase() !== activeBvid?.toLowerCase()) return;

      updateVideo(m.bvid, {
        progress: m.progress,
        stage: m.stage,
        stageParams: m.stageParams,
        error: m.error ?? null,
      });
    };

    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [activeBvid, updateVideo]);

  // -------------------------------------------------------------------------
  // Cleanup countdown on unmount
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  // -------------------------------------------------------------------------
  // Start transcription flow: official subtitle → ASR fallback
  // -------------------------------------------------------------------------
  const startTranscribe = useCallback(
    (video: BiliFavVideo) => {
      if (activeBvid) return;
      if (video.attr === 9) return;

      const { bvid, title } = video;
      setActiveBvid(bvid);

      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }

      updateVideo(bvid, {
        transcribing: true,
        progress: 0,
        stage: 'start',
        error: null,
        retryCountdown: 0,
      });

      (async () => {
        try {
          // 1. Get auth
          const auth = await getBiliAuth();

          // 2. Resolve CID
          updateVideo(bvid, { stage: 'extracting', progress: 5 });
          const cid = await fetchCidByPageList(bvid, 1, auth ?? undefined);

          // 3. Try official subtitle first
          updateVideo(bvid, { stage: 'connectivity', progress: 10 });
          const subtitleResult = await fetchSubtitle(bvid, cid, auth ?? undefined);

          if (subtitleResult.status === 'ok' && subtitleResult.rows.length > 0) {
            const processed = processSubtitles(subtitleResult.rows);

            // Cache the official subtitle
            await browser.runtime
              .sendMessage({ type: 'CACHE_SUBTITLE', bvid, rows: processed, source: 'bilibili' })
              .catch(() => {});

            // Persist to PGlite (fire-and-forget)
            try {
              const db = getDb();
              await persistSubtitleContent(db, bvid, processed, 'bilibili');
            } catch { /* DB not ready — skip silently */ }

            updateVideo(bvid, {
              transcribing: false,
              progress: 100,
              stage: 'done',
              contentStatus: 'has_bilibili',
              error: null,
            });
            setActiveBvid(null);
            return;
          }

          // 4. No official subtitle — fall back to Groq ASR
          if (!hasAsrApiKey) {
            updateVideo(bvid, {
              transcribing: false,
              stage: '',
              error: {
                code: 'ASR_INVALID_KEY',
                message: 'ASR API key not configured',
              },
            });
            setActiveBvid(null);
            return;
          }

          updateVideo(bvid, { stage: 'start', progress: 0 });

          const response: TranscribeResponse = await browser.runtime.sendMessage({
            type: 'TRANSCRIBE_AUDIO',
            bvid,
            cid,
            title,
          });

          if (response.success) {
            // Persist to PGlite (fire-and-forget)
            try {
              const db = getDb();
              await persistSubtitleContent(
                db,
                bvid,
                response.data.rows,
                response.data.source,
              );
            } catch { /* DB not ready — skip silently */ }

            updateVideo(bvid, {
              transcribing: false,
              progress: 100,
              stage: 'done',
              contentStatus: response.data.source === 'bilibili' ? 'has_bilibili' : 'has_groq',
              error: null,
            });
          } else {
            updateVideo(bvid, {
              transcribing: false,
              error: response.error,
            });

            if (response.error.retryAfter) {
              let remaining = response.error.retryAfter;
              updateVideo(bvid, { retryCountdown: remaining });

              countdownRef.current = setInterval(() => {
                remaining--;
                if (remaining <= 0) {
                  if (countdownRef.current) clearInterval(countdownRef.current);
                  countdownRef.current = null;
                  updateVideo(bvid, { retryCountdown: 0 });
                } else {
                  updateVideo(bvid, { retryCountdown: remaining });
                }
              }, 1000);
            }
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : 'unknown error';
          updateVideo(bvid, {
            transcribing: false,
            error: {
              code: 'ASR_UNKNOWN',
              message: detail,
              params: { detail },
            },
          });
        } finally {
          setActiveBvid((current) => (current === bvid ? null : current));
        }
      })();
    },
    [activeBvid, hasAsrApiKey, updateVideo],
  );

  // -------------------------------------------------------------------------
  // Cancel
  // -------------------------------------------------------------------------
  const cancelTranscribe = useCallback(() => {
    if (!activeBvid) return;
    browser.runtime
      .sendMessage({ type: 'TRANSCRIBE_ABORT', bvid: activeBvid })
      .catch(() => {});

    updateVideo(activeBvid, {
      transcribing: false,
      stage: 'cancelled',
    });
    setActiveBvid(null);
  }, [activeBvid, updateVideo]);

  // -------------------------------------------------------------------------
  // Accessor
  // -------------------------------------------------------------------------
  const getState = useCallback(
    (bvid: string): VideoTranscribeState => stateMap.get(bvid) ?? DEFAULT_STATE,
    [stateMap],
  );

  return { getState, startTranscribe, cancelTranscribe, activeBvid };
}
