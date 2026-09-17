import { describe, expect, it, vi } from 'vitest';

import { runTranscriptionPipeline, type PipelineDeps, type PipelineRequest } from './pipeline';

const ROWS = [{ start: 0, end: 1, text: 'line' }];

function request(overrides: Partial<PipelineRequest> = {}): PipelineRequest {
  return {
    videoId: 'BV1XN416DEeR',
    cid: 42,
    title: 'Pipeline test',
    signal: new AbortController().signal,
    officialSourceLabel: 'official',
    asrSourceLabel: 'asr',
    ...overrides,
  };
}

function deps(overrides: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    getAsrConfig: async () => ({ apiKey: 'key', model: 'model', baseUrl: 'https://asr.test' }),
    fetchOfficialSubtitle: async () => null,
    transcribeAudio: async () => ROWS,
    cacheGet: async () => null,
    cacheSave: async () => {},
    postProcess: (rows) => rows,
    ...overrides,
  };
}

// The pipeline is the single owner of the stamp (see its doc comment). These
// cases exist so a platform handler can never ship a success without one: all
// three success exits are here, and all three must name the requested video.
describe('runTranscriptionPipeline videoId stamp', () => {
  it('names the requested video on a cache hit', async () => {
    const result = await runTranscriptionPipeline(
      request(),
      deps({ cacheGet: async () => ({ rows: ROWS, source: 'official' }) }),
      vi.fn(),
    );

    expect(result).toEqual({
      success: true,
      data: { videoId: 'BV1XN416DEeR', rows: ROWS, source: 'official', cached: true },
    });
  });

  it('names the requested video on the official subtitle path', async () => {
    const result = await runTranscriptionPipeline(
      request(),
      deps({ fetchOfficialSubtitle: async () => ROWS }),
      vi.fn(),
    );

    expect(result).toEqual({
      success: true,
      data: { videoId: 'BV1XN416DEeR', rows: ROWS, source: 'official', cached: false },
    });
  });

  it('names the requested video on the ASR path', async () => {
    const result = await runTranscriptionPipeline(request(), deps(), vi.fn());

    expect(result).toEqual({
      success: true,
      data: { videoId: 'BV1XN416DEeR', rows: ROWS, source: 'asr', cached: false },
    });
  });

  // A `VideoCacheEntry` carries its own `videoId`, stored lowercased
  // (`video-cache.ts` normalizes the key). A platform `cacheGet` that returns
  // the raw entry instead of narrowing it still typechecks — extra properties
  // survive a non-literal return — so the spread can hand the pipeline a stale,
  // case-folded id. The stamp is written *after* the spread for exactly this
  // reason: otherwise every cache hit would be refused by the consumer's
  // byte-exact gate, and the fix would look like the bug it guards against.
  it('overrides whatever id the cache hands back with the requested one', async () => {
    const staleEntry = {
      platform: 'bilibili',
      videoId: 'bv1xn416deer',
      rows: ROWS,
      source: 'official' as const,
      rawHash: 'hash',
      updatedAt: 0,
    };

    const result = await runTranscriptionPipeline(
      request(),
      deps({ cacheGet: async () => staleEntry }),
      vi.fn(),
    );

    expect(result.success && result.data.videoId).toBe('BV1XN416DEeR');
  });

  it('stamps the id byte-exact, so a case-only difference stays visible', async () => {
    const result = await runTranscriptionPipeline(
      request({ videoId: 'bv1xn416deer' }),
      deps({ fetchOfficialSubtitle: async () => ROWS }),
      vi.fn(),
    );

    expect(result.success && result.data.videoId).toBe('bv1xn416deer');
  });
});
