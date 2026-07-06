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

describe('resolveEmbeddingConfig — priority: env > user-filled > provider def', () => {
  afterEach(() => vi.unstubAllEnvs());

  const def = getEmbeddingProviderDef('openai');

  // Hermetic: a developer's real .env.local (VITE_EMBEDDING_*) would leak in
  // through import.meta.env otherwise — stub all five to empty explicitly.
  function stubEnvEmpty() {
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', '');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', '');
    vi.stubEnv('VITE_EMBEDDING_MODEL', '');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', '');
    vi.stubEnv('VITE_EMBEDDING_ENABLE', '');
  }

  it('falls back to provider def when both env and user config are empty', () => {
    stubEnvEmpty();
    const r = resolveEmbeddingConfig(makeSettings());
    expect(r.providerId).toBe('openai');
    expect(r.apiKey).toBe('');
    expect(r.baseUrl).toBe(def.baseUrl);
    expect(r.model).toBe(def.defaultModel);
    expect(r.enabled).toBe(false);
  });

  it('uses user-filled config when env is empty', () => {
    stubEnvEmpty();
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

  it('.env.local (VITE_EMBEDDING_*) overrides user-filled config', () => {
    stubEnvEmpty();
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
    expect(r.apiKey).toBe('sk-env');
    expect(r.model).toBe('env-model');
    expect(r.baseUrl).toBe('https://env.example/v1/');
  });

  it('env credential bundle applies regardless of the active provider', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    const r = resolveEmbeddingConfig(makeSettings({ embeddingProvider: 'gemini' }));
    expect(r.providerId).toBe('gemini');
    expect(r.apiKey).toBe('sk-env');
  });

  it('valid VITE_EMBEDDING_PROVIDER overrides settings; cfg and def follow the resolved provider', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'gemini');
    const geminiDef = getEmbeddingProviderDef('gemini');
    const r = resolveEmbeddingConfig(
      makeSettings({
        embeddingProvider: 'openai',
        embeddingConfigs: {
          openai: { apiKey: 'sk-openai-user' },
          gemini: { apiKey: 'sk-gemini-user' },
        },
      }),
    );
    expect(r.providerId).toBe('gemini');
    expect(r.apiKey).toBe('sk-gemini-user'); // cfg lookup keyed by resolved provider
    expect(r.baseUrl).toBe(geminiDef.baseUrl); // def fallback from resolved provider
    expect(r.model).toBe(geminiDef.defaultModel);
  });

  it('invalid VITE_EMBEDDING_PROVIDER is ignored, falls through to settings', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'not-a-provider');
    const r = resolveEmbeddingConfig(makeSettings({ embeddingProvider: 'zhipu' }));
    expect(r.providerId).toBe('zhipu');
  });

  it('VITE_EMBEDDING_ENABLE=true/1/TRUE force-enables regardless of the settings toggle', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_ENABLE', 'true');
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: false })).enabled).toBe(true);
    vi.stubEnv('VITE_EMBEDDING_ENABLE', '1');
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: false })).enabled).toBe(true);
    vi.stubEnv('VITE_EMBEDDING_ENABLE', 'TRUE');
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: false })).enabled).toBe(true);
  });

  it('VITE_EMBEDDING_ENABLE=false/0 force-disables even when the settings toggle is on', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_ENABLE', 'false');
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: true })).enabled).toBe(false);
    vi.stubEnv('VITE_EMBEDDING_ENABLE', '0');
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: true })).enabled).toBe(false);
  });

  it('VITE_EMBEDDING_ENABLE unset falls back to the settings toggle', () => {
    stubEnvEmpty();
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: true })).enabled).toBe(true);
    expect(resolveEmbeddingConfig(makeSettings({ embeddingEnabled: false })).enabled).toBe(false);
  });
});
