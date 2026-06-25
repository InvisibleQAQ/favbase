import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  TranscribeResponse,
  TranscribeStatusPush,
  TranscribeStage,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import type { BiliFavVideo } from '@/lib/bilibili/types';
import { persistSubtitleContent } from '@/lib/bilibili/content-sync';
import { getDb } from '@/lib/database';
import { useRetryCountdown } from '@/lib/hooks/useRetryCountdown';

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
): UseVideoTranscribeReturn {
  const [stateMap, setStateMap] = useState<Map<string, VideoTranscribeState>>(new Map());
  const [activeBvid, setActiveBvid] = useState<string | null>(null);

  const { countdown, startCountdown, resetCountdown } = useRetryCountdown();
  const countdownBvidRef = useRef<string | null>(null);
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
  // Sync shared countdown into the target video's state.
  // Uses a ref (not activeBvid) because activeBvid is cleared in .finally()
  // while countdown may still be ticking from a retryAfter response.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const target = countdownBvidRef.current;
    if (target) {
      updateVideo(target, { retryCountdown: countdown });
      if (countdown === 0) countdownBvidRef.current = null;
    }
  }, [countdown, updateVideo]);

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
  // Start transcription: handler manages official subtitle → ASR fallback
  // -------------------------------------------------------------------------
  const startTranscribe = useCallback(
    (video: BiliFavVideo) => {
      if (activeBvid) return;
      if (video.attr === 9) return;

      const { bvid, title } = video;
      setActiveBvid(bvid);
      countdownBvidRef.current = null;
      resetCountdown();

      updateVideo(bvid, {
        transcribing: true,
        progress: 0,
        stage: 'start',
        error: null,
        retryCountdown: 0,
      });

      browser.runtime
        .sendMessage({ type: 'TRANSCRIBE_AUDIO', bvid, title })
        .then((response: unknown) => {
          const res = response as TranscribeResponse;

          if (res.success) {
            // Persist to PGlite (fire-and-forget)
            try {
              const db = getDb();
              persistSubtitleContent(db, bvid, res.data.rows, res.data.source).catch(() => {});
            } catch { /* DB not ready — skip silently */ }

            updateVideo(bvid, {
              transcribing: false,
              progress: 100,
              stage: 'done',
              contentStatus: res.data.source === 'bilibili' ? 'has_bilibili' : 'has_groq',
              error: null,
            });
          } else {
            updateVideo(bvid, {
              transcribing: false,
              error: res.error,
            });

            if (res.error.retryAfter) {
              countdownBvidRef.current = bvid;
              startCountdown(res.error.retryAfter);
            }
          }
        })
        .catch((err: unknown) => {
          const detail = err instanceof Error ? err.message : 'unknown error';
          updateVideo(bvid, {
            transcribing: false,
            error: {
              code: 'ASR_UNKNOWN',
              message: detail,
              params: { detail },
            },
          });
        })
        .finally(() => {
          setActiveBvid((current) => (current === bvid ? null : current));
        });
    },
    [activeBvid, resetCountdown, startCountdown, updateVideo],
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
