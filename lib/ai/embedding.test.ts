import { describe, it, expect, vi } from 'vitest';
import { EMBEDDING_PROVIDER_IDS } from '@/lib/providers';
import {
  createEmbeddingModel,
  embedText,
  EMBEDDING_DIMENSIONS,
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

describe('embedText provider options', () => {
  it('passes dimensions option for the openai family only', async () => {
    // Fake embedding model that records the providerOptions it receives via the
    // AI SDK `embed` call. We capture through a stub model's doEmbed.
    const seen: Array<Record<string, unknown> | undefined> = [];
    const fakeModel = {
      specificationVersion: 'v3' as const,
      provider: 'test',
      modelId: 'test',
      maxEmbeddingsPerCall: 1,
      supportsParallelCalls: false,
      async doEmbed({ providerOptions }: { providerOptions?: Record<string, unknown> }) {
        seen.push(providerOptions);
        return { embeddings: [[0.1, 0.2, 0.3]] };
      },
    };

    // openai provider -> providerOptions.openai.dimensions present
    await embedText(fakeModel as never, 'hi', 'openai');
    expect(seen[0]).toEqual({ openai: { dimensions: EMBEDDING_DIMENSIONS } });

    // non-openai provider -> no providerOptions
    await embedText(fakeModel as never, 'hi', 'ollama');
    expect(seen[1]).toBeUndefined();
  });
});
