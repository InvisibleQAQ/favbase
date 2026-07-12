import { describe, it, expect, vi } from 'vitest';
import type { UserSettings } from '@/lib/storage';
import { getProviderDef } from '@/lib/providers';
import { buildTaggingPrompt, MAX_CONTENT_CHARS, MAX_EXISTING_TAGS } from './prompt';
import { normalizeTags } from './tagger';
import { resolveTaggingConfig } from './config';

// The storage barrel touches chrome.runtime at load time (wxt storage).
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
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
