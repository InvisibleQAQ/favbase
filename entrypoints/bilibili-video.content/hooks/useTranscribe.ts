import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubtitleRow } from '@/lib/types';
import type {
  TranscribeResponse,
  TranscribeStatusPush,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';

export interface TranscribeState {
  transcribing: boolean;
  progress: number;
  stage: string;
  rows: SubtitleRow[];
  error: TranscribeErrorInfo | null;
  cached: boolean;
  retryCountdown: number;
}

export interface UseTranscribeReturn extends TranscribeState {
  startTranscribe: () => void;
  cancelTranscribe: () => void;
}

export function useTranscribe(
  bvid: string | null,
  cid: number | null,
  title: string,
  hasApiKey: boolean,
): UseTranscribeReturn {
  const [state, setState] = useState<TranscribeState>({
    transcribing: false,
    progress: 0,
    stage: '',
    rows: [],
    error: null,
    cached: false,
    retryCountdown: 0,
  });

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevBvidRef = useRef<string | null>(null);

  useEffect(() => {
    // Abort in-flight transcription when navigating to a different video
    const prevBvid = prevBvidRef.current;
    prevBvidRef.current = bvid;

    if (prevBvid && prevBvid !== bvid) {
      browser.runtime
        .sendMessage({ type: 'TRANSCRIBE_ABORT', bvid: prevBvid })
        .catch(() => {});
    }

    if (!bvid) return;

    setState({
      transcribing: false,
      progress: 0,
      stage: '',
      rows: [],
      error: null,
      cached: false,
      retryCountdown: 0,
    });

    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, [bvid]);

  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as TranscribeStatusPush;
      if (m?.type !== 'TRANSCRIBE_STATUS') return;
      if (m.bvid && m.bvid.toLowerCase() !== bvid?.toLowerCase()) return;

      setState((prev) => ({
        ...prev,
        progress: m.progress,
        stage: m.stage,
        error: m.error ?? prev.error,
      }));
    };

    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [bvid]);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const startTranscribe = useCallback(() => {
    if (!bvid || !cid || !hasApiKey) return;

    setState((prev) => ({
      ...prev,
      transcribing: true,
      progress: 0,
      stage: '',
      error: null,
      retryCountdown: 0,
    }));

    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    browser.runtime
      .sendMessage({ type: 'TRANSCRIBE_AUDIO', bvid, cid, title })
      .then((response: unknown) => {
        const res = response as TranscribeResponse;

        if (res.success) {
          setState((prev) => ({
            ...prev,
            transcribing: false,
            progress: 100,
            stage: '完成',
            rows: res.data.rows,
            cached: res.data.cached,
            error: null,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            transcribing: false,
            error: res.error,
          }));

          if (res.error.retryAfter) {
            let remaining = res.error.retryAfter;
            setState((prev) => ({ ...prev, retryCountdown: remaining }));

            countdownRef.current = setInterval(() => {
              remaining--;
              if (remaining <= 0) {
                if (countdownRef.current) clearInterval(countdownRef.current);
                countdownRef.current = null;
                setState((prev) => ({ ...prev, retryCountdown: 0 }));
              } else {
                setState((prev) => ({ ...prev, retryCountdown: remaining }));
              }
            }, 1000);
          }
        }
      })
      .catch((err: Error) => {
        setState((prev) => ({
          ...prev,
          transcribing: false,
          error: {
            code: 'ASR_UNKNOWN',
            message: err?.message ?? '通信失败',
          },
        }));
      });
  }, [bvid, cid, title, hasApiKey]);

  const cancelTranscribe = useCallback(() => {
    if (!bvid) return;
    browser.runtime.sendMessage({ type: 'TRANSCRIBE_ABORT', bvid }).catch(() => {});
    setState((prev) => ({
      ...prev,
      transcribing: false,
      stage: '已取消',
    }));
  }, [bvid]);

  return {
    ...state,
    startTranscribe,
    cancelTranscribe,
  };
}
