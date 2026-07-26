import { describe, expect, it, vi } from 'vitest';
import type { VideoCacheEntry } from '@/lib/cache/types';
import type { ResolvedSummaryConfig } from './config';
import { PROTOCOL_TAGS } from './prompt';
import { loadCachedSummary, summarizeVideo, type SummaryDeps } from './summary-service';
import { isSummaryError, type SummaryResult } from './types';

// The storage barrel + video-cache touch chrome/wxt storage at load; every test
// injects deps, so these stubs are never called.
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
}));
vi.mock('@/lib/cache/video-cache', () => ({ getVideoCache: vi.fn() }));
vi.mock('./summarizer', () => ({ streamSummary: vi.fn() }));
vi.mock('./summary-cache', () => ({ getSummaryCache: vi.fn(), saveSummaryCache: vi.fn() }));

const subtitle: VideoCacheEntry = {
  platform: 'bilibili',
  videoId: 'bv1',
  rows: [
    { start: 0, end: 10, text: '开场' },
    { start: 10, end: 25, text: '正文' },
  ],
  source: 'official',
  rawHash: 'hash-official',
  updatedAt: 1,
};

const config: ResolvedSummaryConfig = {
  providerId: 'modelscope',
  apiKey: 'k',
  model: 'qwen',
  customBaseUrl: '',
  customProtocol: 'openai',
  enabled: true,
  temperature: 0.3,
};

const MODEL_OUTPUT = [
  PROTOCOL_TAGS.summaryStart,
  '**结论**\n- 值得看',
  PROTOCOL_TAGS.summaryEnd,
  PROTOCOL_TAGS.segmentsStart,
  '[{"start_line":1,"end_line":2,"title":"全片","type":"content"}]',
  PROTOCOL_TAGS.segmentsEnd,
].join('\n');

function makeDeps(overrides: Partial<SummaryDeps> = {}): SummaryDeps {
  let clock = 1000;
  return {
    getConfig: vi.fn().mockResolvedValue(config),
    loadSubtitle: vi.fn().mockResolvedValue(subtitle),
    stream: vi.fn().mockResolvedValue(MODEL_OUTPUT),
    cacheGet: vi.fn().mockResolvedValue(null),
    cacheSave: vi.fn().mockResolvedValue(undefined),
    // Monotonic clock, spaced past the throttle window so partials always emit.
    now: () => (clock += 1000),
    ...overrides,
  };
}

const request = { platform: 'bilibili', videoId: 'bv1', title: '标题' };

describe('summarizeVideo', () => {
  it('generates, decodes both blocks and persists', async () => {
    const deps = makeDeps();
    const result = await summarizeVideo(request, {}, deps);

    expect(result.markdown).toBe('**结论**\n- 值得看');
    expect(result.segments).toEqual([
      { start: 0, end: 25, title: '全片', type: 'content' },
    ]);
    expect(result.subtitleHash).toBe('hash-official');
    expect(result.model).toBe('qwen');
    expect(result.cached).toBe(false);
    expect(deps.cacheSave).toHaveBeenCalledWith('bilibili', 'bv1', expect.objectContaining({
      markdown: '**结论**\n- 值得看',
    }));
  });

  it('serves the cache without calling the LLM, hash-checked against the subtitle', async () => {
    const cached: SummaryResult = {
      markdown: 'old',
      segments: [],
      model: 'qwen',
      subtitleHash: 'hash-official',
      createdAt: 5,
    };
    const deps = makeDeps({ cacheGet: vi.fn().mockResolvedValue(cached) });

    const result = await summarizeVideo(request, {}, deps);

    expect(result).toMatchObject({ markdown: 'old', cached: true });
    expect(deps.cacheGet).toHaveBeenCalledWith('bilibili', 'bv1', 'hash-official');
    expect(deps.stream).not.toHaveBeenCalled();
  });

  it('force skips the cache read entirely', async () => {
    const deps = makeDeps({ cacheGet: vi.fn().mockResolvedValue({ markdown: 'old' }) });
    const result = await summarizeVideo({ ...request, force: true }, {}, deps);

    expect(deps.cacheGet).not.toHaveBeenCalled();
    expect(result.markdown).toBe('**结论**\n- 值得看');
  });

  it('emits throttled partials as decoded summary text, not raw protocol', async () => {
    const partials: string[] = [];
    const deps = makeDeps({
      stream: vi.fn().mockImplementation(async (_c, _p, options) => {
        options.onText?.(`${PROTOCOL_TAGS.summaryStart}\n**结`);
        options.onText?.(`${PROTOCOL_TAGS.summaryStart}\n**结论**`);
        return MODEL_OUTPUT;
      }),
    });

    await summarizeVideo(request, { onPartial: (md) => partials.push(md) }, deps);

    expect(partials).toEqual(['**结', '**结论**']);
  });

  it('fails with NO_SUBTITLE when nothing is cached for the video', async () => {
    const deps = makeDeps({ loadSubtitle: vi.fn().mockResolvedValue(null) });
    await expect(summarizeVideo(request, {}, deps)).rejects.toMatchObject({
      code: 'SUMMARY_NO_SUBTITLE',
    });
  });

  it('fails with NOT_CONFIGURED before spending a request', async () => {
    const deps = makeDeps({
      getConfig: vi.fn().mockResolvedValue({ ...config, enabled: false }),
    });
    await expect(summarizeVideo(request, {}, deps)).rejects.toMatchObject({
      code: 'SUMMARY_NOT_CONFIGURED',
    });
    expect(deps.stream).not.toHaveBeenCalled();
  });

  it('maps an aborted stream to SUMMARY_ABORTED', async () => {
    const controller = new AbortController();
    controller.abort();
    const deps = makeDeps({ stream: vi.fn().mockRejectedValue(new Error('aborted')) });

    await expect(
      summarizeVideo(request, { signal: controller.signal }, deps),
    ).rejects.toMatchObject({ code: 'SUMMARY_ABORTED' });
  });

  it('maps a DOMException-style abort with no signal to SUMMARY_ABORTED', async () => {
    const abortError = new Error('The user aborted a request.');
    abortError.name = 'AbortError';
    const deps = makeDeps({ stream: vi.fn().mockRejectedValue(abortError) });

    await expect(summarizeVideo(request, {}, deps)).rejects.toMatchObject({
      code: 'SUMMARY_ABORTED',
    });
  });

  it('does not mistake a provider error that merely mentions abort for a cancel', async () => {
    const deps = makeDeps({
      stream: vi.fn().mockRejectedValue(new Error('upstream connection aborted by peer')),
    });

    await expect(summarizeVideo(request, {}, deps)).rejects.toMatchObject({
      code: 'SUMMARY_REQUEST_FAILED',
      params: { detail: 'upstream connection aborted by peer' },
    });
  });

  it('maps a provider failure to REQUEST_FAILED with the detail preserved', async () => {
    const deps = makeDeps({ stream: vi.fn().mockRejectedValue(new Error('401 unauthorized')) });
    const err = await summarizeVideo(request, {}, deps).catch((e: unknown) => e);

    expect(isSummaryError(err)).toBe(true);
    expect(err).toMatchObject({
      code: 'SUMMARY_REQUEST_FAILED',
      params: { detail: '401 unauthorized' },
    });
  });

  it('rejects an empty model response instead of caching a blank summary', async () => {
    const deps = makeDeps({ stream: vi.fn().mockResolvedValue('   ') });
    await expect(summarizeVideo(request, {}, deps)).rejects.toMatchObject({
      code: 'SUMMARY_EMPTY_OUTPUT',
    });
    expect(deps.cacheSave).not.toHaveBeenCalled();
  });

  it('still returns the summary when the cache write fails', async () => {
    const deps = makeDeps({ cacheSave: vi.fn().mockRejectedValue(new Error('QUOTA_BYTES')) });
    await expect(summarizeVideo(request, {}, deps)).resolves.toMatchObject({
      markdown: '**结论**\n- 值得看',
    });
  });

  it('keeps the summary when the segments block is unusable', async () => {
    const deps = makeDeps({
      stream: vi.fn().mockResolvedValue(
        `${PROTOCOL_TAGS.summaryStart}\n**结论**\n${PROTOCOL_TAGS.summaryEnd}`,
      ),
    });
    const result = await summarizeVideo(request, {}, deps);
    expect(result.markdown).toBe('**结论**');
    expect(result.segments).toEqual([]);
  });
});

describe('loadCachedSummary', () => {
  it('checks the cache against the current subtitle hash', async () => {
    const deps = makeDeps({ cacheGet: vi.fn().mockResolvedValue(null) });
    await loadCachedSummary('bilibili', 'bv1', deps);
    expect(deps.cacheGet).toHaveBeenCalledWith('bilibili', 'bv1', 'hash-official');
  });

  it('returns null when the video has no subtitle at all', async () => {
    const deps = makeDeps({ loadSubtitle: vi.fn().mockResolvedValue(null) });
    await expect(loadCachedSummary('bilibili', 'bv1', deps)).resolves.toBeNull();
    expect(deps.cacheGet).not.toHaveBeenCalled();
  });
});
