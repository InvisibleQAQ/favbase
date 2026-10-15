import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoObjectGeneratedError, type LanguageModelUsage } from 'ai';
import { ZodError } from 'zod';
import type { UserSettings } from '@/lib/storage';
import { getProviderDef } from '@/lib/providers';
import {
  buildTaggingPrompt,
  MAX_CONTENT_CHARS,
  MAX_EXISTING_TAGS,
  TAGGING_SYSTEM_PROMPT,
} from './prompt';
import { generateTags, normalizeTags, TaggingSpendError } from './tagger';
import { resolveTaggingConfig, type ResolvedTaggingConfig } from './config';

// The storage barrel touches chrome.runtime at load time (wxt storage).
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
}));

// `resolveTaggingConfig` delegates to the real `lib/storage/resolve`, which
// falls back to `import.meta.env` — Vite loads the developer's .env into tests,
// so the env tier is neutralized explicitly instead of by mocking the resolver
// (mocking it would test nothing).
beforeEach(() => {
  vi.stubEnv('VITE_MODELSCOPE_API_KEY', '');
  vi.stubEnv('VITE_MODELSCOPE_MODEL', '');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// Intercept only the LLM call; createLanguageModel/prompt building run real.
const { generateObjectMock } = vi.hoisted(() => ({ generateObjectMock: vi.fn() }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  generateObject: generateObjectMock,
}));

function makeSettings(overrides?: Partial<UserSettings>): UserSettings {
  return {
    provider: 'modelscope',
    providerApiKeys: {},
    providerModels: {},
    customBaseUrl: '',
    customModel: '',
    customProtocol: 'openai',
    asrProvider: 'groq',
    asrConfigs: {},
    embeddingProvider: 'openai',
    embeddingConfigs: {},
    prefMode: 'efficiency',
    temperature: 0.3,
    maxTokens: 100000,
    taggingDailyTokenBudget: 5_000_000,
    ...overrides,
  };
}

describe('resolveTaggingConfig', () => {
  it('enables tagging when the active provider has an apiKey', () => {
    const config = resolveTaggingConfig(
      makeSettings({ providerApiKeys: { modelscope: 'sk-test' }, providerModels: { modelscope: 'qwen' } }),
    );
    expect(config).toMatchObject({
      providerId: 'modelscope',
      apiKey: 'sk-test',
      model: 'qwen',
      enabled: true,
    });
  });

  it('disables tagging when no apiKey resolves', () => {
    const config = resolveTaggingConfig(makeSettings());
    expect(config.enabled).toBe(false);
  });

  it('falls back to the provider default model', () => {
    const config = resolveTaggingConfig(makeSettings({ providerApiKeys: { modelscope: 'sk' } }));
    expect(config.model).toBe(getProviderDef('modelscope').defaultModel);
  });

  it('only reads the active provider key (no cross-provider leak)', () => {
    const config = resolveTaggingConfig(makeSettings({ providerApiKeys: { openai: 'sk-other' } }));
    expect(config.apiKey).toBe('');
    expect(config.enabled).toBe(false);
  });
});

describe('buildTaggingPrompt', () => {
  it('includes all provided fields', () => {
    const prompt = buildTaggingPrompt(
      { title: 'T', author: 'A', description: 'D', content: 'C' },
      ['tag1', 'tag2'],
    );
    expect(prompt).toContain('标题: T');
    expect(prompt).toContain('作者: A');
    expect(prompt).toContain('简介: D');
    expect(prompt).toContain('正文节选: C');
    expect(prompt).toContain('已有标签: tag1、tag2');
  });

  it('omits absent optional fields', () => {
    const prompt = buildTaggingPrompt({ title: 'T' }, []);
    expect(prompt).not.toContain('作者:');
    expect(prompt).not.toContain('简介:');
    expect(prompt).not.toContain('正文节选:');
    expect(prompt).not.toContain('已有标签:');
  });

  it('truncates content to MAX_CONTENT_CHARS', () => {
    const prompt = buildTaggingPrompt({ title: 'T', content: 'x'.repeat(MAX_CONTENT_CHARS + 500) }, []);
    const line = prompt.split('\n').find((l) => l.startsWith('正文节选:'))!;
    expect(line.length).toBe('正文节选: '.length + MAX_CONTENT_CHARS);
  });

  it('caps existing tags at MAX_EXISTING_TAGS', () => {
    const existing = Array.from({ length: MAX_EXISTING_TAGS + 10 }, (_, i) => `t${i}`);
    const prompt = buildTaggingPrompt({ title: 'T' }, existing);
    expect(prompt).toContain(`t${MAX_EXISTING_TAGS - 1}`);
    expect(prompt).not.toContain(`t${MAX_EXISTING_TAGS}、`);
  });

  // OpenAI-spec json_object mode 400s unless the prompt contains "json",
  // and never sends the Zod schema — the prompt must carry both the word
  // and the expected shape.
  it('mentions JSON and the expected output shape (json_object hard constraint)', () => {
    const prompt = buildTaggingPrompt({ title: 'T' }, []);
    expect(prompt).toMatch(/json/i);
    expect(prompt).toContain('{"tags":');
    expect(TAGGING_SYSTEM_PROMPT).toMatch(/json/i);
  });
});

describe('generateTags', () => {
  // Braces matter: a function returned from beforeEach runs as teardown, and
  // mockReset() returns the mock itself — a rejecting mock would fail the test.
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  const input = { title: 'T' };

  function makeTaggingConfig(overrides?: Partial<ResolvedTaggingConfig>): ResolvedTaggingConfig {
    return {
      providerId: 'deepseek',
      apiKey: 'sk-test',
      model: 'deepseek-v4-flash',
      enabled: true,
      ...overrides,
    };
  }

  it('uses no-schema for json_object-only providers (no responseFormat warning)', async () => {
    generateObjectMock.mockResolvedValue({ object: { tags: ['前端', 'React'] } });
    const { tags } = await generateTags(makeTaggingConfig(), input, []);
    expect(tags).toEqual(['前端', 'React']);
    const args = generateObjectMock.mock.calls[0][0];
    expect(args.output).toBe('no-schema');
    expect(args.schema).toBeUndefined();
  });

  it('sends the Zod schema for schema-delivery providers', async () => {
    generateObjectMock.mockResolvedValue({ object: { tags: ['React'] } });
    await generateTags(
      makeTaggingConfig({ providerId: 'openai', model: 'gpt-4o-mini' }),
      input,
      [],
    );
    const args = generateObjectMock.mock.calls[0][0];
    expect(args.schema).toBeDefined();
    expect(args.output).toBeUndefined();
  });

  it('no-schema path rejects malformed output via Zod parse', async () => {
    generateObjectMock.mockResolvedValue({ object: { tags: 'not-an-array' } });
    await expect(generateTags(makeTaggingConfig(), input, [])).rejects.toThrow();
  });

  it('no-schema path normalizes valid output (trim + blank drop + dedupe)', async () => {
    generateObjectMock.mockResolvedValue({
      object: { tags: [' 前端 ', '前端', 'React', ' ', 'Vue'] },
    });
    const { tags } = await generateTags(makeTaggingConfig(), input, []);
    expect(tags).toEqual(['前端', 'React', 'Vue']);
  });
});

// docs/41 D3: the Tagging Budget is charged input + output tokens of every call
// that came back, estimated from characters when the endpoint reports none.
describe('generateTags spend', () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  const input = { title: 'T', content: '正文' };
  const existing = ['旧标签'];
  const promptChars = TAGGING_SYSTEM_PROMPT.length + buildTaggingPrompt(input, existing).length;

  function usage(inputTokens?: number, outputTokens?: number): LanguageModelUsage {
    return {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens !== undefined && outputTokens !== undefined
          ? inputTokens + outputTokens
          : undefined,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    };
  }

  function noObject(text: string | undefined, spent: LanguageModelUsage) {
    return new NoObjectGeneratedError({
      message: 'No object generated: could not parse the response.',
      text,
      response: { id: 'r', timestamp: new Date(0), modelId: 'm' },
      usage: spent,
      finishReason: 'stop',
    });
  }

  const configs: Array<[string, ResolvedTaggingConfig]> = [
    ['no-schema', { providerId: 'deepseek', apiKey: 'k', model: 'm', enabled: true }],
    ['schema', { providerId: 'openai', apiKey: 'k', model: 'gpt-4o-mini', enabled: true }],
  ];

  it.each(configs)('%s branch reports input + output tokens', async (_, config) => {
    generateObjectMock.mockResolvedValue({ object: { tags: ['React'] }, usage: usage(1_200, 35) });
    await expect(generateTags(config, input, existing)).resolves.toEqual({
      tags: ['React'],
      tokens: 1_235,
    });
  });

  it.each(configs)(
    '%s branch estimates from characters when the endpoint reports no usage',
    async (_, config) => {
      const object = { tags: ['前端', 'React'] };
      generateObjectMock.mockResolvedValue({ object, usage: usage(undefined, undefined) });

      const { tokens } = await generateTags(config, input, existing);

      expect(tokens).toBe(promptChars + JSON.stringify(object).length);
    },
  );

  it('estimates each missing field on its own', async () => {
    const object = { tags: ['React'] };
    generateObjectMock.mockResolvedValue({ object, usage: usage(900, undefined) });

    const { tokens } = await generateTags(configs[0][1], input, existing);

    expect(tokens).toBe(900 + JSON.stringify(object).length);
  });

  it('estimates a reported zero too: openai-compatible turns a missing count into 0', async () => {
    const object = { tags: ['React'] };
    generateObjectMock.mockResolvedValue({ object, usage: usage(0, 0) });

    const { tokens } = await generateTags(configs[0][1], input, existing);

    expect(tokens).toBe(promptChars + JSON.stringify(object).length);
  });

  it('carries the usage of a NoObjectGeneratedError on the thrown error', async () => {
    const cause = noObject('{"tags":', usage(800, 12));
    generateObjectMock.mockRejectedValue(cause);

    const err = await generateTags(configs[1][1], input, existing).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TaggingSpendError);
    expect((err as TaggingSpendError).tokens).toBe(812);
    expect((err as TaggingSpendError).cause).toBe(cause);
  });

  it('estimates a NoObjectGeneratedError without usage from the prompt and its raw text', async () => {
    generateObjectMock.mockRejectedValue(noObject('not json at all', usage(undefined, undefined)));

    const err = await generateTags(configs[0][1], input, existing).catch((e: unknown) => e);

    expect((err as TaggingSpendError).tokens).toBe(promptChars + 'not json at all'.length);
  });

  it('charges a no-schema call whose output then fails the client-side Zod parse', async () => {
    // The call succeeded and was billed; only our own shape check rejected it.
    generateObjectMock.mockResolvedValue({
      object: { tags: 'not-an-array' },
      usage: usage(500, 20),
    });

    const err = await generateTags(configs[0][1], input, existing).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TaggingSpendError);
    expect((err as TaggingSpendError).tokens).toBe(520);
    expect((err as TaggingSpendError).cause).toBeInstanceOf(ZodError);
  });

  it('rethrows a failure that never got a response unchanged (nothing to charge)', async () => {
    const httpError = new Error('401 Unauthorized');
    generateObjectMock.mockRejectedValue(httpError);

    await expect(generateTags(configs[0][1], input, existing)).rejects.toBe(httpError);
  });
});

describe('normalizeTags', () => {
  it('trims, drops blanks, dedupes, caps at 5', () => {
    expect(normalizeTags([' 前端 ', '前端', '', '  ', 'React', 'Vue', 'CSS', 'HTML', 'JS'])).toEqual([
      '前端',
      'React',
      'Vue',
      'CSS',
      'HTML',
    ]);
  });

  it('returns empty for empty input', () => {
    expect(normalizeTags([])).toEqual([]);
  });
});
