import type { SubtitleRow } from '@/lib/subtitle/types';
import {
  createErrorInfo,
  isTranscribeError,
} from './types';
import {
  GROQ_TRANSCRIPTION_PROMPT,
  ASR_TASK_TIMEOUT_MS,
  ASR_CONNECTIVITY_TIMEOUT_MS,
  AUDIO_FILE_NAME,
  AUDIO_MIME_TYPE,
} from './constants';

const DEFAULT_ASR_BASE_URL = 'https://api.groq.com/openai/v1';

interface GroqSegment {
  start: number;
  end: number;
  text: string;
}

interface GroqTranscriptionResponse {
  text: string;
  segments?: GroqSegment[];
}

interface GroqQuota {
  remainingTokens: number;
  remainingRequests: number;
  resetTokens: string;
}

interface GroqTranscriptionResult {
  rows: SubtitleRow[];
  quota: GroqQuota;
}

export async function ensureGroqConnectivity(
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const modelsUrl = `${baseUrl || DEFAULT_ASR_BASE_URL}/models`;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    ASR_CONNECTIVITY_TIMEOUT_MS,
  );

  try {
    const res = await fetch(modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (res.status === 401) {
      throw createErrorInfo('ASR_INVALID_KEY', `ASR API key invalid (401) at ${modelsUrl}`);
    }
    if (res.status === 403) {
      throw createErrorInfo('ASR_GROQ_ACCESS_BLOCKED', `ASR API access blocked (403) at ${modelsUrl}`);
    }
    if (!res.ok) {
      throw createErrorInfo('ASR_GROQ_UNREACHABLE', `ASR connectivity check failed: HTTP ${res.status} at ${modelsUrl}`);
    }
  } catch (err) {
    if (isTranscribeError(err)) throw err;
    throw createErrorInfo('ASR_GROQ_UNREACHABLE', `Cannot reach ASR API (${modelsUrl}): ${(err as Error).message ?? 'network error'}`);
  } finally {
    clearTimeout(timer);
  }
}

export async function requestGroqTranscription(
  audioBlob: Blob,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
  baseUrl?: string,
): Promise<GroqTranscriptionResult> {
  const transcribeUrl = `${baseUrl || DEFAULT_ASR_BASE_URL}/audio/transcriptions`;
  const file = new File([audioBlob], AUDIO_FILE_NAME, { type: AUDIO_MIME_TYPE });

  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  formData.append('prompt', GROQ_TRANSCRIPTION_PROMPT);
  formData.append('timestamp_granularities[]', 'segment');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASR_TASK_TIMEOUT_MS);

  const combinedSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;

  try {
    const res = await fetch(transcribeUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: combinedSignal,
    });

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res);
      const info = createErrorInfo('ASR_RATE_LIMIT', `Groq rate limited (retry after ${retryAfter}s)`);
      info.retryAfter = retryAfter;
      throw info;
    }

    if (res.status === 401) {
      throw createErrorInfo('ASR_INVALID_KEY', 'Groq API key invalid (401)');
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const apiMsg = (body as any)?.error?.message ?? `HTTP ${res.status}`;
      throw createErrorInfo('ASR_UNKNOWN', `Groq API error: ${apiMsg}`, { detail: apiMsg });
    }

    const quota = parseQuota(res);
    const data: GroqTranscriptionResponse = await res.json();
    const rows = mapTranscriptionToRows(data);

    return { rows, quota };
  } catch (err) {
    if (isTranscribeError(err)) throw err;
    if ((err as Error).name === 'AbortError') {
      throw createErrorInfo('ASR_REQUEST_TIMEOUT', 'Transcription request timed out');
    }
    const detail = (err as Error).message ?? 'transcription failed';
    throw createErrorInfo('ASR_UNKNOWN', `Transcription failed: ${detail}`, { detail });
  } finally {
    clearTimeout(timer);
  }
}

export function mapTranscriptionToRows(
  data: GroqTranscriptionResponse,
): SubtitleRow[] {
  if (!data.segments?.length) return [];

  return data.segments
    .map((seg) => {
      const text = seg.text?.trim();
      if (!text) return null;
      return {
        start: Number(seg.start),
        end: Number(seg.end) || Number(seg.start) + 3,
        text,
      };
    })
    .filter((r): r is SubtitleRow => r !== null);
}

function parseRetryAfter(res: Response): number {
  const header = res.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (!Number.isNaN(seconds)) return seconds;
  }
  return 30;
}

function parseQuota(res: Response): GroqQuota {
  return {
    remainingTokens: Number(
      res.headers.get('x-ratelimit-remaining-tokens') ?? 0,
    ),
    remainingRequests: Number(
      res.headers.get('x-ratelimit-remaining-requests') ?? 0,
    ),
    resetTokens: res.headers.get('x-ratelimit-reset-tokens') ?? '',
  };
}
