import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubtitleRow } from '@/lib/subtitle/types';
import type {
  TranscribeResponse,
  TranscribeStatusPush,
  TranscribeStage,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import { useRetryCountdown } from '@/lib/hooks/useRetryCountdown';

export interface TranscribeState {
  transcribing: boolean;
  progress: number;
  stage: TranscribeStage | '';
  stageParams?: Record<string, string | number>;
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
  const [state, setState] = useState<Omit<TranscribeState, 'retryCountdown'>>({
    transcribing: false,
    progress: 0,
    stage: '',
    rows: [],
    error: null,
    cached: false,
  });

  const { countdown, startCountdown, resetCountdown } = useRetryCountdown();
  const bvidRef = useRef<string | null>(null);

  useEffect(() => {
    const prevBvid = bvidRef.current;
    bvidRef.current = bvid;

    if (prevBvid && prevBvid !== bvid) {
      browser.runtime
        .sendMessage({ type: 'TRANSCRIBE_ABORT', videoId: prevBvid })
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
    });
    resetCountdown();
  }, [bvid, resetCountdown]);

  useEffect(() => {
    const handler = (msg: unknown) => {
      const m = msg as TranscribeStatusPush;
      if (m?.type !== 'TRANSCRIBE_STATUS') return;
      if (m.videoId && m.videoId.toLowerCase() !== bvid?.toLowerCase()) return;

      setState((prev) => ({
        ...prev,
        progress: m.progress,
        stage: m.stage,
        stageParams: m.stageParams,
        error: m.error ?? prev.error,
      }));
    };

    browser.runtime.onMessage.addListener(handler);
    return () => browser.runtime.onMessage.removeListener(handler);
  }, [bvid]);

  const startTranscribe = useCallback(() => {
    if (!bvid || !cid || !hasApiKey) return;

    setState((prev) => ({
      ...prev,
      transcribing: true,
      progress: 0,
      stage: '',
      error: null,
    }));
    resetCountdown();

    browser.runtime
      .sendMessage({ type: 'TRANSCRIBE_AUDIO', platform: 'bilibili', videoId: bvid, cid, title })
      .then((response: unknown) => {
        if (bvidRef.current?.toLowerCase() !== bvid?.toLowerCase()) return;
        const res = response as TranscribeResponse;

        if (res.success) {
          setState((prev) => ({
            ...prev,
            transcribing: false,
            progress: 100,
            stage: 'done',
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
            startCountdown(res.error.retryAfter);
          }
        }
      })
      .catch((err: Error) => {
        if (bvidRef.current?.toLowerCase() !== bvid?.toLowerCase()) return;
        const detail = err?.message ?? 'communication failed';
        setState((prev) => ({
          ...prev,
          transcribing: false,
          error: {
            code: 'ASR_UNKNOWN',
            message: detail,
            params: { detail },
          },
        }));
      });
  }, [bvid, cid, title, hasApiKey, resetCountdown, startCountdown]);

  const cancelTranscribe = useCallback(() => {
    if (!bvid) return;
    browser.runtime.sendMessage({ type: 'TRANSCRIBE_ABORT', videoId: bvid }).catch(() => {});
    setState((prev) => ({
      ...prev,
      transcribing: false,
      stage: 'cancelled',
    }));
  }, [bvid]);

  return {
    ...state,
    retryCountdown: countdown,
    startTranscribe,
    cancelTranscribe,
  };
}
