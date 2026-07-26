import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SummaryErrorInfo,
  SummaryResponse,
  SummaryResult,
  SummaryStatusPush,
  VideoSegment,
} from '@/lib/summary/types';

const PLATFORM = 'bilibili';

export interface SummaryState {
  generating: boolean;
  /** Partial while streaming, final once done. */
  markdown: string;
  segments: VideoSegment[];
  model: string;
  createdAt: number;
  cached: boolean;
  error: SummaryErrorInfo | null;
}

export interface UseSummaryReturn extends SummaryState {
  generate: () => void;
  regenerate: () => void;
  cancel: () => void;
}

const EMPTY: SummaryState = {
  generating: false,
  markdown: '',
  segments: [],
  model: '',
  createdAt: 0,
  cached: false,
  error: null,
};

function toState(result: SummaryResult & { cached: boolean }): SummaryState {
  return {
    generating: false,
    markdown: result.markdown,
    segments: result.segments,
    model: result.model,
    createdAt: result.createdAt,
    cached: result.cached,
    error: null,
  };
}

/**
 * Summary state for the panel. Mirrors `useTranscribe`: request/response over
 * runtime messaging, live progress via a background push, and a bvid staleness
 * guard so video A's result can never land in video B's panel after an SPA nav.
 */
export function useSummary(bvid: string | null, title: string): UseSummaryReturn {
  const [state, setState] = useState<SummaryState>(EMPTY);
  const bvidRef = useRef<string | null>(null);

  const isStale = useCallback(
    (id: string | null) => bvidRef.current?.toLowerCase() !== id?.toLowerCase(),
    [],
  );

  /** Read-only cache probe — never triggers an LLM call. */
  const probeCache = useCallback(
    (id: string) => {
      browser.runtime
        .sendMessage({ type: 'GET_SUMMARY_CACHE', platform: PLATFORM, videoId: id })
        .then((response: unknown) => {
          if (isStale(id)) return;
          const cached = response as SummaryResult | null;
          if (cached) setState(toState({ ...cached, cached: true }));
        })
        .catch(() => {});
    },
    [isStale],
  );

  // SPA navigation: abort the previous video's job, reset, then probe the cache
  // for the new one.
  useEffect(() => {
    const prevBvid = bvidRef.current;
    bvidRef.current = bvid;

    if (prevBvid && prevBvid !== bvid) {
      browser.runtime
        .sendMessage({ type: 'SUMMARIZE_ABORT', videoId: prevBvid })
        .catch(() => {});
    }

    setState(EMPTY);
    if (bvid) probeCache(bvid);
  }, [bvid, probeCache]);

  // Streaming partials
  useEffect(() => {
    const handler = (msg: unknown) => {
      const push = msg as SummaryStatusPush;
      if (push?.type !== 'SUMMARY_STATUS') return;
      if (push.videoId.toLowerCase() !== bvid?.toLowerCase()) return;
      setState((prev) => (prev.generating ? { ...prev, markdown: push.markdown } : prev));
    };

    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [bvid]);

  const run = useCallback(
    (force: boolean) => {
      if (!bvid) return;

      setState((prev) => ({
        ...prev,
        generating: true,
        error: null,
        markdown: force ? '' : prev.markdown,
        segments: force ? [] : prev.segments,
      }));

      browser.runtime
        .sendMessage({
          type: 'SUMMARIZE_VIDEO',
          platform: PLATFORM,
          videoId: bvid,
          title,
          force,
        })
        .then((response: unknown) => {
          if (isStale(bvid)) return;
          const res = response as SummaryResponse;
          if (res.success) {
            setState(toState(res.data));
          } else {
            // A user-initiated cancel comes back as SUMMARY_ABORTED — that is
            // not a failure worth an error box.
            const error = res.error.code === 'SUMMARY_ABORTED' ? null : res.error;
            setState((prev) => ({ ...prev, generating: false, error }));
          }
        })
        .catch((err: Error) => {
          if (isStale(bvid)) return;
          const detail = err?.message ?? 'communication failed';
          setState((prev) => ({
            ...prev,
            generating: false,
            error: { code: 'SUMMARY_REQUEST_FAILED', message: detail, params: { detail } },
          }));
        });
    },
    [bvid, title, isStale],
  );

  const generate = useCallback(() => run(false), [run]);
  const regenerate = useCallback(() => run(true), [run]);

  const cancel = useCallback(() => {
    if (!bvid) return;
    browser.runtime.sendMessage({ type: 'SUMMARIZE_ABORT', videoId: bvid }).catch(() => {});
    // Drop the half-streamed text — it was never persisted and must not look
    // like a finished summary — then fall back to whatever the cache holds.
    setState(EMPTY);
    probeCache(bvid);
  }, [bvid, probeCache]);

  return { ...state, generate, regenerate, cancel };
}
