import {
  PipelineError,
  type SubtitleRow,
  type TranscribeErrorInfo,
} from './types';
import {
  GROQ_TRANSCRIBE_URL,
  GROQ_MODELS_URL,
  GROQ_TRANSCRIPTION_PROMPT,
  ASR_TASK_TIMEOUT_MS,
  ASR_CONNECTIVITY_TIMEOUT_MS,
  AUDIO_FILE_NAME,
  AUDIO_MIME_TYPE,
} from './constants';

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

export class AsrError extends PipelineError {
  constructor(info: TranscribeErrorInfo) {
    super(info);
    this.name = 'AsrError';
  }
}

export async function ensureGroqConnectivity(apiKey: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    ASR_CONNECTIVITY_TIMEOUT_MS,
  );

  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (res.status === 401) {
      throw new AsrError({
        code: 'ASR_INVALID_KEY',
        message: 'Groq API key invalid (401)',
      });
    }
    if (res.status === 403) {
      throw new AsrError({
        code: 'ASR_GROQ_ACCESS_BLOCKED',
        message: 'Groq API access blocked (403)',
      });
    }
    if (!res.ok) {
      throw new AsrError({
        code: 'ASR_GROQ_UNREACHABLE',
        message: `Groq connectivity check failed: HTTP ${res.status}`,
      });
    }
  } catch (err) {
    if (err instanceof AsrError) throw err;
    throw new AsrError({
      code: 'ASR_GROQ_UNREACHABLE',
      message: `Cannot reach Groq API: ${(err as Error).message ?? 'network error'}`,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function requestGroqTranscription(
  audioBlob: Blob,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<GroqTranscriptionResult> {
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
    const res = await fetch(GROQ_TRANSCRIBE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
      signal: combinedSignal,
    });

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res);
      throw new AsrError({
        code: 'ASR_RATE_LIMIT',
        message: `Groq rate limited (retry after ${retryAfter}s)`,
        retryAfter,
      });
    }

    if (res.status === 401) {
      throw new AsrError({
        code: 'ASR_INVALID_KEY',
        message: 'Groq API key invalid (401)',
      });
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const apiMsg = (body as any)?.error?.message ?? `HTTP ${res.status}`;
      throw new AsrError({
        code: 'ASR_UNKNOWN',
        message: `Groq API error: ${apiMsg}`,
        params: { detail: apiMsg },
      });
    }

    const quota = parseQuota(res);
    const data: GroqTranscriptionResponse = await res.json();
    const rows = mapTranscriptionToRows(data);

    return { rows, quota };
  } catch (err) {
    if (err instanceof AsrError) throw err;
    if ((err as Error).name === 'AbortError') {
      throw new AsrError({
        code: 'ASR_REQUEST_TIMEOUT',
        message: 'Transcription request timed out',
      });
    }
    const detail = (err as Error).message ?? 'transcription failed';
    throw new AsrError({
      code: 'ASR_UNKNOWN',
      message: `Transcription failed: ${detail}`,
      params: { detail },
    });
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
