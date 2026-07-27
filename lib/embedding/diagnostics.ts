export const EMBEDDING_TRACE_PREFIX = '[embedding:trace]';

export type EmbeddingTraceStage =
  | 'scheduler'
  | 'job'
  | 'config'
  | 'query'
  | 'provider'
  | 'persistence';

export interface EmbeddingTraceDetails {
  traceId?: string;
  platform?: string;
  jobPlatform?: string;
  itemId?: string;
  platformItemId?: string;
  source?: string;
  stage?: EmbeddingTraceStage;
  phase?: string;
  done?: number;
  total?: number;
  failed?: number;
  queueDepth?: number;
  chunkCount?: number;
  charCount?: number;
  providerId?: string;
  model?: string;
  dimensions?: number;
  vectorCount?: number;
  vectorDimensions?: number;
  elapsedMs?: number;
}

interface EmbeddingErrorSummary {
  name: string;
  message: string;
  stack?: string;
  status?: string | number;
  code?: string | number;
  cause?: EmbeddingErrorSummary;
}

type TraceSink = (...args: unknown[]) => void;

const TRACE_DETAIL_KEYS = [
  'traceId',
  'platform',
  'jobPlatform',
  'itemId',
  'platformItemId',
  'source',
  'stage',
  'phase',
  'done',
  'total',
  'failed',
  'queueDepth',
  'chunkCount',
  'charCount',
  'providerId',
  'model',
  'dimensions',
  'vectorCount',
  'vectorDimensions',
  'elapsedMs',
] as const satisfies readonly (keyof EmbeddingTraceDetails)[];

let traceSequence = 0;

export function createEmbeddingTraceId(source: string): string {
  traceSequence += 1;
  return `${source}-${Date.now().toString(36)}-${traceSequence.toString(36)}`;
}

export function embeddingTrace(
  event: string,
  details: EmbeddingTraceDetails = {},
  sink: TraceSink = console.info,
): void {
  try {
    sink(EMBEDDING_TRACE_PREFIX, event, sanitizeTraceDetails(details));
  } catch {
    // Diagnostics must never alter the embedding pipeline's control flow.
  }
}

function sanitizeTraceDetails(details: EmbeddingTraceDetails): EmbeddingTraceDetails {
  const input = details as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of TRACE_DETAIL_KEYS) {
    const value = input[key];
    if (typeof value === 'string') safe[key] = value;
    if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
  }
  return safe as EmbeddingTraceDetails;
}

function redactCredentials(value: string): string {
  return value
    .replace(
      /((?:"?authorization"?\s*:\s*)"?)(?:bearer\s+)?[^"\s,;}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\bbearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /([?&](?:api[_-]?key|access[_-]?token|token|key|secret|password)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    )
    .replace(
      /((?:"?(?:api[_ -]?key|access[_ -]?token|token|secret|password)"?\s*[:=]\s*)"?)[^"\s,;&}]+/gi,
      '$1[REDACTED]',
    );
}

function summarizeError(error: unknown, includeCause = true): EmbeddingErrorSummary {
  if (!(error instanceof Error)) {
    return { name: typeof error, message: redactCredentials(String(error)) };
  }

  const candidate = error as Error & {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    cause?: unknown;
  };
  const status = candidate.status ?? candidate.statusCode;

  return {
    name: error.name,
    message: redactCredentials(error.message),
    ...(error.stack ? { stack: redactCredentials(error.stack) } : {}),
    ...(typeof status === 'string' || typeof status === 'number' ? { status } : {}),
    ...(typeof candidate.code === 'string' || typeof candidate.code === 'number'
      ? { code: candidate.code }
      : {}),
    ...(includeCause && candidate.cause instanceof Error
      ? { cause: summarizeError(candidate.cause, false) }
      : {}),
  };
}

export function embeddingTraceError(
  event: string,
  error: unknown,
  details: EmbeddingTraceDetails = {},
  sink: TraceSink = console.error,
): void {
  try {
    sink(EMBEDDING_TRACE_PREFIX, event, {
      ...sanitizeTraceDetails(details),
      error: summarizeError(error),
    });
  } catch {
    // Diagnostics must never alter the embedding pipeline's control flow.
  }
}
