export {
  type SummaryTone,
  type SummaryDetail,
  type SegmentType,
  type VideoSegment,
  type SummaryResult,
  type SummarizeRequest,
  type SummarizeAbort,
  type GetSummaryCacheRequest,
  type SummaryStatusPush,
  type SummaryErrorCode,
  type SummaryErrorInfo,
  type SummaryResponse,
  createSummaryError,
  isSummaryError,
} from './types';

export {
  buildSummaryPrompt,
  formatSubtitleForPrompt,
  PROTOCOL_TAGS,
  DEFAULT_TONE,
  DEFAULT_DETAIL,
} from './prompt';

export { parseSummarySection, parseSegments, extractSection } from './protocol';

export {
  type ResolvedSummaryConfig,
  resolveSummaryConfig,
  getSummaryConfig,
} from './config';

export { streamSummary, type StreamSummaryOptions } from './summarizer';

export { getSummaryCache, saveSummaryCache } from './summary-cache';

export {
  summarizeVideo,
  loadCachedSummary,
  type SummaryDeps,
  type SummarizeVideoRequest,
  type SummarizeVideoOptions,
  PARTIAL_EMIT_INTERVAL_MS,
} from './summary-service';
