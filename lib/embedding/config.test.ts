import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmbeddingProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { resolveEmbeddingConfig } from './config';

// config.ts value-imports `settingsStorage`, whose barrel eagerly touches
// `@wxt-dev/storage` (chrome.runtime) at load. Stub it out — the resolver under
// test is pure and never reads storage. Mirrors lib/i18n/index.test.ts.
vi.mock('@/lib/storage', () => ({
  settingsStorage: {
    getValue: () => Promise.resolve({}),
    setValue: () => Promise.resolve(),
    watch: () => () => {},
  },
}));

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    provider: 'openai',
    providerApiKeys: {},
    providerModels: {},
    customBaseUrl: '',
    customModel: '',
    customProtocol: 'openai',
    asrProvider: 'groq',
    asrConfigs: {},
    embeddingEnabled: false,
    embeddingProvider: 'openai',
    embeddingConfigs: {},
    prefMode: 'efficiency',
    temperature: 0.3,
    maxTokens: 1000,
    ...overrides,
  } as UserSettings;
}

describe('resolveEmbeddingConfig — priority: user-filled > env > provider def', () => {
  afterEach(() => vi.unstubAllEnvs());

  const def = getEmbeddingProviderDef('openai');

  it('falls back to provider def when both user config and env are empty', () => {
    const r = resolveEmbeddingConfig(makeSettings());
    expect(r.apiKey).toBe('');
    expect(r.baseUrl).toBe(def.baseUrl);
    expect(r.model).toBe(def.defaultModel);
  });

  it('uses .env.local (VITE_EMBEDDING_*) when user config is empty', () => {
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    vi.stubEnv('VITE_EMBEDDING_MODEL', 'env-model');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', 'https://env.example/v1/');
    const r = resolveEmbeddingConfig(makeSettings());
    expect(r.apiKey).toBe('sk-env');
    expect(r.model).toBe('env-model');
    expect(r.baseUrl).toBe('https://env.example/v1/');
  });

  it('user-filled config overrides env', () => {
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    vi.stubEnv('VITE_EMBEDDING_MODEL', 'env-model');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', 'https://env.example/v1/');
    const r = resolveEmbeddingConfig(
      makeSettings({
        embeddingConfigs: {
          openai: { apiKey: 'sk-user', model: 'user-model', baseUrl: 'https://user.example/v1/' },
        },
      }),
    );
    expect(r.apiKey).toBe('sk-user');
    expect(r.model).toBe('user-model');
    expect(r.baseUrl).toBe('https://user.example/v1/');
  });

  it('env credential bundle applies regardless of the active provider', () => {
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    const r = resolveEmbeddingConfig(makeSettings({ embeddingProvider: 'gemini' }));
    expect(r.providerId).toBe('gemini');
    expect(r.apiKey).toBe('sk-env');
  });
});
