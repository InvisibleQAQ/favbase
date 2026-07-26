import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { UserSettings } from '@/lib/storage';
import { getProviderDef } from '@/lib/providers';
import {
  buildTaggingPrompt,
  MAX_CONTENT_CHARS,
  MAX_EXISTING_TAGS,
  TAGGING_SYSTEM_PROMPT,
} from './prompt';
import { generateTags, normalizeTags } from './tagger';
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
  beforeEach(() => generateObjectMock.mockReset());

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
    const tags = await generateTags(makeTaggingConfig(), input, []);
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
    const tags = await generateTags(makeTaggingConfig(), input, []);
    expect(tags).toEqual(['前端', 'React', 'Vue']);
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
