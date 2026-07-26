/**
 * AI video summary domain types — platform-agnostic.
 *
 * One LLM call produces both a Markdown summary and chapter segments, framed
 * by an output protocol (see `prompt.ts`). The two degrade independently: a
 * missing/undecodable SEGMENTS block still yields a usable summary.
 */

export type SummaryTone = 'casual' | 'balanced' | 'professional';
export type SummaryDetail = 'brief' | 'normal' | 'detailed';

/** Chapter kind. `ad` marks a sponsor/promotion stretch (display-only badge). */
export type SegmentType = 'content' | 'ad';

export interface VideoSegment {
  /** Seconds, mapped from subtitle line numbers — never model-invented. */
  start: number;
  end: number;
  title: string;
  type: SegmentType;
}

export interface SummaryResult {
  markdown: string;
  segments: VideoSegment[];
  /** Model that produced it — shown in the UI footer, also invalidation aid. */
  model: string;
  /**
   * `rawHash` of the subtitle rows this summary was built from
   * (`VideoCacheEntry.rawHash`). A source switch (official → asr) changes the
   * hash and makes the cached summary a miss.
   */
  subtitleHash: string;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Messages (content script ↔ background SW)
// ---------------------------------------------------------------------------

export interface SummarizeRequest {
  type: 'SUMMARIZE_VIDEO';
  platform: string;
  videoId: string;
  title: string;
  /** Skip the cache and regenerate. */
  force?: boolean;
}

export interface SummarizeAbort {
  type: 'SUMMARIZE_ABORT';
  videoId: string;
}

/**
 * Read-only cache probe (mirrors `GET_VIDEO_CACHE`) — lets the panel show an
 * existing summary on open without a "generate" click and without ever risking
 * an LLM call. Resolves to `SummaryResult | null`.
 */
export interface GetSummaryCacheRequest {
  type: 'GET_SUMMARY_CACHE';
  platform: string;
  videoId: string;
}

/** Streaming progress push — carries the partial Markdown accumulated so far. */
export interface SummaryStatusPush {
  type: 'SUMMARY_STATUS';
  videoId: string;
  markdown: string;
}

// ---------------------------------------------------------------------------
// Errors — plain data (IPC-safe), mirroring `lib/transcription/types.ts`
// ---------------------------------------------------------------------------

export type SummaryErrorCode =
  | 'SUMMARY_NOT_CONFIGURED'
  | 'SUMMARY_NO_SUBTITLE'
  | 'SUMMARY_EMPTY_OUTPUT'
  | 'SUMMARY_ABORTED'
  | 'SUMMARY_DUPLICATE'
  | 'SUMMARY_REQUEST_FAILED';

export interface SummaryErrorInfo {
  code: SummaryErrorCode;
  /** Debug detail — never rendered raw; the UI translates by `code`. */
  message: string;
  params?: Record<string, string | number>;
}

export interface SummarySuccess {
  success: true;
  data: SummaryResult & { cached: boolean };
}

export interface SummaryFailure {
  success: false;
  error: SummaryErrorInfo;
}

export type SummaryResponse = SummarySuccess | SummaryFailure;

export function createSummaryError(
  code: SummaryErrorCode,
  message: string,
  params?: Record<string, string | number>,
): SummaryErrorInfo {
  return { code, message, ...(params && { params }) };
}

export function isSummaryError(err: unknown): err is SummaryErrorInfo {
  return (
    err != null &&
    typeof err === 'object' &&
    'code' in err &&
    'message' in err &&
    typeof (err as SummaryErrorInfo).code === 'string' &&
    (err as SummaryErrorInfo).code.startsWith('SUMMARY_')
  );
}
