import { useEffect, useState } from 'react';
import { fetchSubtitle } from '@/lib/bilibili/bilibili-api';
import { processSubtitles } from '@/lib/bilibili/subtitle-processor';
import { onBiliMessage } from '@/lib/bilibili/messaging';
import { onVideoCacheChange } from '@/lib/cache/video-cache';
import type { SubtitleRow } from '@/lib/transcription/types';

export interface SubtitleState {
  rows: SubtitleRow[];
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  source: 'bilibili' | 'groq' | null;
  cached: boolean;
}

const INTERCEPT_TIMEOUT = 3000;
const API_RETRY_DELAY = 3500;
const MAX_API_RETRIES = 2;

/**
 * Fetch subtitles when bvid + cid become available.
 *
 * Data flow priority (high -> low):
 *   1. Video cache (GET_VIDEO_CACHE message to Background)
 *   2. Intercept channel (BILI_SUBTITLE_DATA from inject script)
 *   3. API fallback (fetchSubtitle)
 *   4. No subtitle -> TranscribeButton shown by parent
 *
 * All successful fetches write back to cache via CACHE_SUBTITLE message.
 * Cross-tab sync via chrome.storage.onChanged listener.
 */
export function useSubtitle(
  bvid: string | null,
  cid: number | null,
): SubtitleState {
  const [state, setState] = useState<SubtitleState>({
    rows: [],
    loading: false,
    status: null,
    error: null,
    source: null,
    cached: false,
  });

  // --- Main fetch effect: cache check + dual-channel ---
  useEffect(() => {
    if (!bvid || !cid) return;

    let cancelled = false;
    let resolved = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;

    setState({
      rows: [],
      loading: true,
      status: null,
      error: null,
      source: null,
      cached: false,
    });

    // Step 1: Check cache first (highest priority)
    browser.runtime
      .sendMessage({ type: 'GET_VIDEO_CACHE', bvid })
      .then(
        (
          result: {
            rows: SubtitleRow[];
            source: 'bilibili' | 'groq';
            cached: true;
          } | null,
        ) => {
          if (cancelled || resolved) return;
          if (result) {
            resolved = true;
            if (fallbackTimer) clearTimeout(fallbackTimer);
            setState({
              rows: result.rows,
              loading: false,
              status: 'ok',
              error: null,
              source: result.source,
              cached: true,
            });
          }
        },
      )
      .catch(() => {}); // Cache miss is not an error

    // Step 2: Listen for intercept channel (parallel with cache check)
    const unsubData = onBiliMessage('BILI_SUBTITLE_DATA', (payload) => {
      if (cancelled || resolved) return;
      if (payload.bvid?.toLowerCase() !== bvid?.toLowerCase()) return;

      resolved = true;
      if (fallbackTimer) clearTimeout(fallbackTimer);

      const processed = processSubtitles(payload.data);
      const hasRows = processed.length > 0;

      setState({
        rows: processed,
        loading: false,
        status: hasRows ? 'ok' : 'no_subtitle',
        error: null,
        source: 'bilibili',
        cached: false,
      });

      // Write B-site subtitles to cache
      if (hasRows) {
        browser.runtime
          .sendMessage({
            type: 'CACHE_SUBTITLE',
            bvid,
            rows: processed,
            source: 'bilibili' as const,
          })
          .catch(() => {});
      }
    });

    // Step 3: API fallback with retry
    function attemptApiFetch() {
      if (cancelled || resolved) return;

      fallbackTimer = setTimeout(
        () => {
          if (cancelled || resolved) return;

          (async () => {
            try {
              const result = await fetchSubtitle(bvid!, cid!);
              if (cancelled || resolved) return;

              if (result.status === 'ok' && result.rows.length > 0) {
                resolved = true;
                const processed = processSubtitles(result.rows);
                const hasRows = processed.length > 0;

                setState({
                  rows: processed,
                  loading: false,
                  status: hasRows ? 'ok' : 'no_subtitle',
                  error: null,
                  source: 'bilibili',
                  cached: false,
                });

                // Write to cache
                if (hasRows) {
                  browser.runtime
                    .sendMessage({
                      type: 'CACHE_SUBTITLE',
                      bvid: bvid!,
                      rows: processed,
                      source: 'bilibili' as const,
                    })
                    .catch(() => {});
                }
              } else if (retryCount < MAX_API_RETRIES) {
                retryCount++;
                attemptApiFetch();
              } else {
                resolved = true;
                setState({
                  rows: [],
                  loading: false,
                  status: result.status,
                  error: result.error ?? null,
                  source: null,
                  cached: false,
                });
              }
            } catch {
              if (cancelled || resolved) return;

              if (retryCount < MAX_API_RETRIES) {
                retryCount++;
                attemptApiFetch();
              } else {
                resolved = true;
                setState({
                  rows: [],
                  loading: false,
                  status: 'no_subtitle',
                  error: null,
                  source: null,
                  cached: false,
                });
              }
            }
          })();
        },
        retryCount === 0 ? INTERCEPT_TIMEOUT : API_RETRY_DELAY,
      );
    }

    attemptApiFetch();

    return () => {
      cancelled = true;
      unsubData();
      if (fallbackTimer) clearTimeout(fallbackTimer);
    };
  }, [bvid, cid]);

  // --- Storage change watcher for cross-tab sync ---
  useEffect(() => {
    if (!bvid) return;

    return onVideoCacheChange(bvid, (entry) => {
      setState({
        rows: entry.rows,
        loading: false,
        status: 'ok',
        error: null,
        source: entry.source,
        cached: true,
      });
    });
  }, [bvid]);

  return state;
}
