import { describe, it, expect, vi, beforeEach } from 'vitest';
import { embed, embedMany, type EmbeddingModel } from 'ai';
import { EMBEDDING_PROVIDER_IDS } from '@/lib/providers';
import {
  createEmbeddingModel,
  embeddingProviderOptions,
  embedText,
  embedTexts,
  testEmbeddingConnection,
} from './embedding';

// Spy on the SDK constructors so we can assert which one each provider routes to
// without any network access. Each returns an object with the two factory
// methods createEmbeddingModel may call, tagged with the sdk name.
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    textEmbeddingModel: (model: string) => ({ __sdk: 'openai', model }),
  })),
}));
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    textEmbeddingModel: (model: string) => ({ __sdk: 'google', model }),
  })),
}));
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn(() => ({
    textEmbeddingModel: (model: string) => ({ __sdk: 'openai-compatible', model }),
  })),
}));

// Mock the AI SDK entry so embedText/embedTexts assertions can inspect the
// providerOptions actually handed to embed()/embedMany() — no network.
vi.mock('ai', () => ({
  embed: vi.fn(async () => ({ embedding: [0.1, 0.2, 0.3] })),
  embedMany: vi.fn(async ({ values }: { values: string[] }) => ({
    embeddings: values.map(() => [0.1, 0.2]),
  })),
}));

const fakeModel = { __sdk: 'fake' } as unknown as EmbeddingModel;

beforeEach(() => {
  vi.mocked(embed).mockClear();
  vi.mocked(embedMany).mockClear();
});

describe('createEmbeddingModel provider mapping', () => {
  it('returns a model for every registered embedding provider', () => {
    for (const providerId of EMBEDDING_PROVIDER_IDS) {
      const model = createEmbeddingModel({
        providerId,
        apiKey: 'test-key',
        model: 'test-model',
      }) as unknown as { __sdk: string; model: string };
      expect(model).toBeTruthy();
      expect(model.model).toBe('test-model');
    }
  });

  it('routes each provider to the correct SDK branch', () => {
    const expected: Record<string, string> = {
      openai: 'openai',
      gemini: 'google',
      zhipu: 'openai-compatible',
      siliconflow: 'openai-compatible',
      ollama: 'openai-compatible',
      custom: 'openai-compatible',
    };

    for (const providerId of EMBEDDING_PROVIDER_IDS) {
      const model = createEmbeddingModel({
        providerId,
        apiKey: 'test-key',
        model: 'm',
      }) as unknown as { __sdk: string };
      expect(model.__sdk).toBe(expected[providerId]);
    }
  });
});

describe('embeddingProviderOptions', () => {
  it('openai sdkType uses the `openai` key with `dimensions`', () => {
    expect(embeddingProviderOptions('openai', 1024)).toEqual({
      openai: { dimensions: 1024 },
    });
  });

  it('google sdkType (gemini) uses the `google` key with `outputDimensionality`', () => {
    expect(embeddingProviderOptions('gemini', 768)).toEqual({
      google: { outputDimensionality: 768 },
    });
  });

  it('openai-compatible providers key by providerId with `dimensions`', () => {
    for (const providerId of ['zhipu', 'siliconflow', 'ollama', 'custom'] as const) {
      expect(embeddingProviderOptions(providerId, 512)).toEqual({
        [providerId]: { dimensions: 512 },
      });
    }
  });

  it('returns undefined when dimensions is unset or invalid', () => {
    expect(embeddingProviderOptions('openai')).toBeUndefined();
    expect(embeddingProviderOptions('openai', undefined)).toBeUndefined();
    expect(embeddingProviderOptions('openai', 0)).toBeUndefined();
    expect(embeddingProviderOptions('openai', -5)).toBeUndefined();
    expect(embeddingProviderOptions('openai', Number.NaN)).toBeUndefined();
    expect(embeddingProviderOptions('openai', Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});

describe('embedText / embedTexts providerOptions passthrough', () => {
  it('embedText forwards built providerOptions to embed()', async () => {
    await embedText(fakeModel, 'hello', { providerId: 'openai', dimensions: 1024 });
    expect(embed).toHaveBeenCalledWith({
      model: fakeModel,
      value: 'hello',
      providerOptions: { openai: { dimensions: 1024 } },
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('embedText without options sends no providerOptions (native dimension)', async () => {
    await embedText(fakeModel, 'hello');
    expect(embed).toHaveBeenCalledWith({
      model: fakeModel,
      value: 'hello',
      providerOptions: undefined,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('embedTexts forwards built providerOptions to embedMany()', async () => {
    await embedTexts(fakeModel, ['a', 'b'], { providerId: 'zhipu', dimensions: 512 });
    expect(embedMany).toHaveBeenCalledWith({
      model: fakeModel,
      values: ['a', 'b'],
      providerOptions: { zhipu: { dimensions: 512 } },
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('preserves provider concurrency while aborting a call after the deadline', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    vi.mocked(embedMany).mockImplementationOnce(
      ({ abortSignal }: { abortSignal?: AbortSignal }) =>
        new Promise((_, reject) => {
          abortSignal?.addEventListener('abort', () => reject(abortSignal.reason), {
            once: true,
          });
        }),
    );

    try {
      const result = embedTexts(fakeModel, ['stuck'], { providerId: 'openai' });
      await Promise.resolve();
      const request = vi.mocked(embedMany).mock.calls[0][0];

      expect(request).not.toHaveProperty('maxParallelCalls');
      expect(request.abortSignal).toBeInstanceOf(AbortSignal);
      expect(timeout).toHaveBeenCalledWith(60_000);

      controller.abort(new DOMException('The operation timed out', 'TimeoutError'));
      await expect(result).rejects.toMatchObject({ name: 'TimeoutError' });
    } finally {
      timeout.mockRestore();
    }
  });

  it('embedTexts with options but no dimensions sends no providerOptions', async () => {
    await embedTexts(fakeModel, ['a'], { providerId: 'zhipu' });
    expect(embedMany).toHaveBeenCalledWith({
      model: fakeModel,
      values: ['a'],
      providerOptions: undefined,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it('embedTexts short-circuits on empty input without calling embedMany', async () => {
    const out = await embedTexts(fakeModel, [], { providerId: 'openai', dimensions: 256 });
    expect(out).toEqual([]);
    expect(embedMany).not.toHaveBeenCalled();
  });
});

describe('testEmbeddingConnection', () => {
  it('probes with the configured dimensions so the result reflects real storage', async () => {
    const result = await testEmbeddingConnection({
      providerId: 'openai',
      apiKey: 'k',
      model: 'text-embedding-3-large',
      dimensions: 1024,
    });

    expect(embed).toHaveBeenCalledTimes(1);
    expect(vi.mocked(embed).mock.calls[0][0].providerOptions).toEqual({
      openai: { dimensions: 1024 },
    });
    // Mocked embed returns a 3-dim vector; result must report the REAL length.
    expect(result).toEqual({
      success: true,
      message: 'Embedded probe vector (3 dimensions)',
      dimensions: 3,
    });
  });

  it('probes without truncation when dimensions is unset', async () => {
    await testEmbeddingConnection({ providerId: 'gemini', apiKey: 'k', model: 'm' });
    expect(vi.mocked(embed).mock.calls[0][0].providerOptions).toBeUndefined();
  });
});
