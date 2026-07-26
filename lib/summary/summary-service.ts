/**
 * Summary orchestration: cache → prompt → stream → decode → cache.
 *
 * Platform-agnostic and dependency-injected (mirrors `TaggingDeps` /
 * `PipelineDeps`), so the whole flow is testable without chrome.storage or a
 * live LLM. Throws `SummaryErrorInfo` plain objects — IPC-safe by construction.
 */

import { getVideoCache } from '@/lib/cache/video-cache';
import type { VideoCacheEntry } from '@/lib/cache/types';
import type { ResolvedSummaryConfig } from './config';
import { getSummaryConfig } from './config';
import { buildSummaryPrompt } from './prompt';
import { parseSegments, parseSummarySection } from './protocol';
import { getSummaryCache, saveSummaryCache } from './summary-cache';
import { streamSummary, type StreamSummaryOptions } from './summarizer';
import { createSummaryError, type SummaryResult } from './types';

/** Partial-render cadence. Matches Bilitato's 350ms write throttle. */
export const PARTIAL_EMIT_INTERVAL_MS = 300;

export interface SummaryDeps {
  getConfig: () => Promise<ResolvedSummaryConfig>;
  loadSubtitle: (platform: string, videoId: string) => Promise<VideoCacheEntry | null>;
  stream: (
    config: ResolvedSummaryConfig,
    prompt: string,
    options: StreamSummaryOptions,
  ) => Promise<string>;
  cacheGet: (
    platform: string,
    videoId: string,
    subtitleHash: string,
  ) => Promise<SummaryResult | null>;
  cacheSave: (platform: string, videoId: string, result: SummaryResult) => Promise<void>;
  now: () => number;
}

const defaultDeps: SummaryDeps = {
  getConfig: getSummaryConfig,
  loadSubtitle: getVideoCache,
  stream: streamSummary,
  cacheGet: getSummaryCache,
  cacheSave: saveSummaryCache,
  now: () => Date.now(),
};

export interface SummarizeVideoRequest {
  platform: string;
  videoId: string;
  title: string;
  force?: boolean;
}

export interface SummarizeVideoOptions {
  /** Throttled partial Markdown for live rendering. */
  onPartial?: (markdown: string) => void;
  signal?: AbortSignal;
}

function hasName(err: unknown): err is { name: unknown } {
  return typeof err === 'object' && err !== null && 'name' in err;
}

/**
 * Only a real cancellation counts. The signal is authoritative (the sole way to
 * abort is our own controller); the name check covers a DOMException raised
 * between the signal firing and this frame.
 *
 * Deliberately NOT a fuzzy `/abort/i` match on the message: a provider failure
 * that merely *mentions* an abort would then be swallowed into the UI's "user
 * cancelled" state — no summary, no error, no explanation. Failures stay loud.
 */
function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const name = hasName(err) ? err.name : '';
  return name === 'AbortError' || name === 'ResponseAborted';
}

/**
 * Cached summary for a video, hash-checked against the current subtitle.
 * Never calls the LLM — this is the panel's "do we already have one?" probe.
 */
export async function loadCachedSummary(
  platform: string,
  videoId: string,
  deps: SummaryDeps = defaultDeps,
): Promise<SummaryResult | null> {
  const subtitle = await deps.loadSubtitle(platform, videoId);
  if (!subtitle || subtitle.rows.length === 0) return null;
  return deps.cacheGet(platform, videoId, subtitle.rawHash);
}

export async function summarizeVideo(
  request: SummarizeVideoRequest,
  options: SummarizeVideoOptions = {},
  deps: SummaryDeps = defaultDeps,
): Promise<SummaryResult & { cached: boolean }> {
  const { platform, videoId, title, force } = request;

  const subtitle = await deps.loadSubtitle(platform, videoId);
  if (!subtitle || subtitle.rows.length === 0) {
    throw createSummaryError('SUMMARY_NO_SUBTITLE', `no cached subtitle for ${videoId}`);
  }

  if (!force) {
    const cached = await deps.cacheGet(platform, videoId, subtitle.rawHash);
    if (cached) return { ...cached, cached: true };
  }

  const config = await deps.getConfig();
  if (!config.enabled) {
    throw createSummaryError('SUMMARY_NOT_CONFIGURED', 'no LLM apiKey/model resolved');
  }

  const prompt = buildSummaryPrompt({ title, rows: subtitle.rows });

  let lastEmitAt = 0;
  const emitPartial = (fullText: string) => {
    if (!options.onPartial) return;
    const at = deps.now();
    if (at - lastEmitAt < PARTIAL_EMIT_INTERVAL_MS) return;
    lastEmitAt = at;
    options.onPartial(parseSummarySection(fullText));
  };

  let raw: string;
  try {
    raw = await deps.stream(config, prompt, { onText: emitPartial, signal: options.signal });
  } catch (err) {
    if (isAbort(err, options.signal)) {
      throw createSummaryError('SUMMARY_ABORTED', 'stream aborted');
    }
    const detail = err instanceof Error ? err.message : String(err);
    throw createSummaryError('SUMMARY_REQUEST_FAILED', detail, { detail });
  }

  const markdown = parseSummarySection(raw);
  if (!markdown) {
    throw createSummaryError('SUMMARY_EMPTY_OUTPUT', 'model returned no summary text');
  }

  const result: SummaryResult = {
    markdown,
    segments: parseSegments(raw, subtitle.rows),
    model: config.model,
    subtitleHash: subtitle.rawHash,
    createdAt: deps.now(),
  };

  // Cache is an optimization — a quota failure must not lose the summary the
  // user is already looking at.
  try {
    await deps.cacheSave(platform, videoId, result);
  } catch (err) {
    console.warn('[summary] cache save failed', err);
  }

  return { ...result, cached: false };
}
