import { afterEach, describe, expect, it, vi } from 'vitest';
import { getEmbeddingProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { resolveEmbeddingConfig } from './config';

// config.ts value-imports `settingsStorage`, whose barrel eagerly touches
// `@wxt-dev/storage` (chrome.runtime) at load. Stub it out — the resolver under
// test is pure and never reads storage. Mirrors lib/i18n/index.test.ts.
// `config.ts` reads settings through the storage LEAF (the barrel would also
// evaluate ui-state/agent-bridge items at load), so mock the leaf.
vi.mock('@/lib/storage/settings', () => ({
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
    embeddingProvider: 'openai',
    embeddingConfigs: {},
    prefMode: 'efficiency',
    temperature: 0.3,
    maxTokens: 1000,
    ...overrides,
  } as UserSettings;
}

describe('resolveEmbeddingConfig — priority: user-filled > env > provider def (env only for the target provider)', () => {
  afterEach(() => vi.unstubAllEnvs());

  const def = getEmbeddingProviderDef('openai');

  // Hermetic: a developer's real .env.local (VITE_EMBEDDING_*) would leak in
  // through import.meta.env otherwise — stub all four to empty explicitly.
  function stubEnvEmpty() {
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', '');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', '');
    vi.stubEnv('VITE_EMBEDDING_MODEL', '');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', '');
  }

  it('falls back to provider def when both user config and env are empty; enabled=false (no key)', () => {
    stubEnvEmpty();
    const r = resolveEmbeddingConfig(makeSettings());
    expect(r.providerId).toBe('openai');
    expect(r.apiKey).toBe('');
    expect(r.baseUrl).toBe(def.baseUrl);
    expect(r.model).toBe(def.defaultModel);
    expect(r.enabled).toBe(false);
  });

  it('uses env (VITE_EMBEDDING_*) as the default when the user left fields empty', () => {
    stubEnvEmpty();
    // env bundle is gated to VITE_EMBEDDING_PROVIDER; pair it with the resolved
    // provider (openai) so this reflects real usage (bundle targets that provider).
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'openai');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    vi.stubEnv('VITE_EMBEDDING_MODEL', 'env-model');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', 'https://env.example/v1/');
    const r = resolveEmbeddingConfig(makeSettings());
    expect(r.apiKey).toBe('sk-env');
    expect(r.model).toBe('env-model');
    expect(r.baseUrl).toBe('https://env.example/v1/');
    expect(r.enabled).toBe(true); // key resolved → enabled
  });

  it('user-filled config overrides env (env is only the default starting point)', () => {
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
    expect(r.apiKey).toBe('sk-user');
    expect(r.model).toBe('user-model');
    expect(r.baseUrl).toBe('https://user.example/v1/');
    expect(r.enabled).toBe(true);
  });

  it('per-field fallback: user key wins, env fills the fields the user left blank', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'openai'); // env bundle targets the resolved provider
    vi.stubEnv('VITE_EMBEDDING_MODEL', 'env-model');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', 'https://env.example/v1/');
    const r = resolveEmbeddingConfig(
      makeSettings({
        embeddingConfigs: { openai: { apiKey: 'sk-user' } },
      }),
    );
    expect(r.apiKey).toBe('sk-user'); // user
    expect(r.model).toBe('env-model'); // env (user blank)
    expect(r.baseUrl).toBe('https://env.example/v1/'); // env (user blank)
  });

  it('enabled is derived from the resolved apiKey (!!apiKey), not any toggle', () => {
    stubEnvEmpty();
    expect(resolveEmbeddingConfig(makeSettings()).enabled).toBe(false);
    expect(
      resolveEmbeddingConfig(
        makeSettings({ embeddingConfigs: { openai: { apiKey: 'sk-user' } } }),
      ).enabled,
    ).toBe(true);
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'openai'); // env bundle targets the resolved provider
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    expect(resolveEmbeddingConfig(makeSettings()).enabled).toBe(true);
  });

  it('env bundle does NOT leak to a provider other than VITE_EMBEDDING_PROVIDER', () => {
    // env bundle targets `custom`; active provider is `gemini` → env must not apply.
    stubEnvEmpty();
    const geminiDef = getEmbeddingProviderDef('gemini');
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'custom');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    vi.stubEnv('VITE_EMBEDDING_MODEL', 'text-embedding-3-large');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', 'https://api.gptgod.online/v1');
    const r = resolveEmbeddingConfig(makeSettings({ embeddingProvider: 'gemini' }));
    expect(r.providerId).toBe('gemini');
    expect(r.apiKey).toBe(''); // env key does not follow onto gemini
    expect(r.baseUrl).toBe(geminiDef.baseUrl); // gemini def, not gptgod
    expect(r.model).toBe(geminiDef.defaultModel); // gemini def, not env model
    expect(r.enabled).toBe(false);
  });

  it('env bundle fully applies to its designated provider (VITE_EMBEDDING_PROVIDER)', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'custom');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', 'sk-env');
    vi.stubEnv('VITE_EMBEDDING_MODEL', 'text-embedding-3-large');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', 'https://api.gptgod.online/v1');
    const r = resolveEmbeddingConfig(makeSettings({ embeddingProvider: 'custom' }));
    expect(r.providerId).toBe('custom');
    expect(r.apiKey).toBe('sk-env');
    expect(r.model).toBe('text-embedding-3-large');
    expect(r.baseUrl).toBe('https://api.gptgod.online/v1');
    expect(r.enabled).toBe(true);
  });

  it('settings.embeddingProvider drives cfg/def lookup; user cfg keyed by resolved provider', () => {
    stubEnvEmpty();
    const geminiDef = getEmbeddingProviderDef('gemini');
    const r = resolveEmbeddingConfig(
      makeSettings({
        embeddingProvider: 'gemini',
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

  it('valid VITE_EMBEDDING_PROVIDER seeds the provider only when settings has none', () => {
    // settings.embeddingProvider is undefined → env provider is used as the seed.
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'gemini');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', '');
    vi.stubEnv('VITE_EMBEDDING_MODEL', '');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', '');
    const s = makeSettings();
    delete (s as { embeddingProvider?: unknown }).embeddingProvider;
    const r = resolveEmbeddingConfig(s);
    expect(r.providerId).toBe('gemini');
  });

  it('invalid VITE_EMBEDDING_PROVIDER is ignored, falls back to openai when settings has none', () => {
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'not-a-provider');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', '');
    vi.stubEnv('VITE_EMBEDDING_MODEL', '');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', '');
    const s = makeSettings();
    delete (s as { embeddingProvider?: unknown }).embeddingProvider;
    const r = resolveEmbeddingConfig(s);
    expect(r.providerId).toBe('openai');
  });

  it('settings.embeddingProvider takes precedence over VITE_EMBEDDING_PROVIDER', () => {
    stubEnvEmpty();
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', 'gemini');
    const r = resolveEmbeddingConfig(makeSettings({ embeddingProvider: 'zhipu' }));
    expect(r.providerId).toBe('zhipu');
  });
});

describe('resolveEmbeddingConfig — dimensions (user config only, no env/def fallback)', () => {
  afterEach(() => vi.unstubAllEnvs());

  function stubEnvEmpty() {
    vi.stubEnv('VITE_EMBEDDING_PROVIDER', '');
    vi.stubEnv('VITE_EMBEDDING_API_KEY', '');
    vi.stubEnv('VITE_EMBEDDING_MODEL', '');
    vi.stubEnv('VITE_EMBEDDING_BASE_URL', '');
  }

  it('passes through a user-configured positive number', () => {
    stubEnvEmpty();
    const r = resolveEmbeddingConfig(
      makeSettings({ embeddingConfigs: { openai: { apiKey: 'k', dimensions: 1024 } } }),
    );
    expect(r.dimensions).toBe(1024);
  });

  it('resolves to undefined when not configured', () => {
    stubEnvEmpty();
    const r = resolveEmbeddingConfig(
      makeSettings({ embeddingConfigs: { openai: { apiKey: 'k' } } }),
    );
    expect(r.dimensions).toBeUndefined();
  });

  it('filters invalid values (0 / negative / NaN / Infinity / non-number) to undefined', () => {
    stubEnvEmpty();
    const invalid: unknown[] = [0, -5, Number.NaN, Number.POSITIVE_INFINITY, '1024'];
    for (const dimensions of invalid) {
      const r = resolveEmbeddingConfig(
        makeSettings({
          embeddingConfigs: { openai: { apiKey: 'k', dimensions: dimensions as number } },
        }),
      );
      expect(r.dimensions, `dimensions=${String(dimensions)}`).toBeUndefined();
    }
  });

  it('dimensions is keyed by the resolved provider, not leaked across providers', () => {
    stubEnvEmpty();
    const r = resolveEmbeddingConfig(
      makeSettings({
        embeddingProvider: 'gemini',
        embeddingConfigs: {
          openai: { apiKey: 'k', dimensions: 1024 },
          gemini: { apiKey: 'k' },
        },
      }),
    );
    expect(r.dimensions).toBeUndefined();
  });
});
