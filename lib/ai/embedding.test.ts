import { describe, it, expect, vi } from 'vitest';
import { EMBEDDING_PROVIDER_IDS } from '@/lib/providers';
import { createEmbeddingModel } from './embedding';

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
