import { describe, expect, it } from 'vitest';
import {
  canonicalizeSettings,
  DEFAULT_SETTINGS,
  SettingsValidationError,
  type UserSettings,
} from './settings-schema';

describe('canonicalizeSettings', () => {
  it('fills missing known fields with the current defaults', () => {
    expect(canonicalizeSettings({ provider: 'openai' })).toEqual({
      ...DEFAULT_SETTINGS,
      provider: 'openai',
    });
  });

  it('migrates legacy flat ASR fields into the canonical provider record', () => {
    const canonical = canonicalizeSettings({
      groqApiKey: 'groq-key',
      groqModel: 'whisper-large-v3',
      siliconFlowApiKey: 'sf-key',
      siliconFlowAsrModel: 'FunAudioLLM/SenseVoiceSmall',
    });

    expect(canonical.asrConfigs).toEqual({
      groq: { apiKey: 'groq-key', model: 'whisper-large-v3' },
      siliconflow: {
        apiKey: 'sf-key',
        model: 'FunAudioLLM/SenseVoiceSmall',
      },
    });
    expect(canonical).not.toHaveProperty('groqApiKey');
    expect(canonical).not.toHaveProperty('siliconFlowApiKey');
  });

  it('keeps an existing structured ASR config authoritative during migration', () => {
    const canonical = canonicalizeSettings({
      asrConfigs: {
        groq: { apiKey: 'current-key', model: 'current-model' },
      },
      groqApiKey: 'legacy-key',
      groqModel: 'legacy-model',
    });

    expect(canonical.asrConfigs).toEqual({
      groq: { apiKey: 'current-key', model: 'current-model' },
    });
    expect(canonical).not.toHaveProperty('groqApiKey');
  });

  it('rejects present malformed known fields instead of hiding them with defaults', () => {
    const invalidInputs: unknown[] = [
      null,
      [],
      { provider: 'not-a-provider' },
      { asrProvider: 'not-an-asr-provider' },
      { embeddingProvider: 'not-an-embedding-provider' },
      { customProtocol: 'xml' },
      { prefMode: 'turbo' },
      { providerApiKeys: { openai: 42 } },
      { asrConfigs: { groq: { apiKey: 'key', model: 42 } } },
      { embeddingConfigs: { openai: { apiKey: 'key', dimensions: 0 } } },
      { temperature: Number.NaN },
      { temperature: 3 },
      { maxTokens: 1.5 },
      { maxTokens: 0 },
      { githubToken: 42 },
      { configSavedAt: { llm: -1 } },
      { groqApiKey: 42 },
    ];

    for (const input of invalidInputs) {
      expect(() => canonicalizeSettings(input)).toThrow(SettingsValidationError);
    }
  });

  it('preserves unknown fields for forward-compatible round trips', () => {
    const canonical = canonicalizeSettings({
      provider: 'openai',
      futureSetting: { enabled: true },
      asrConfigs: {
        future: { apiKey: 'key', model: 'model', region: 'future-region' },
      },
      embeddingConfigs: {
        future: { apiKey: 'key', transport: 'future-transport' },
      },
    }) as UserSettings & Record<string, unknown>;

    expect(canonical.futureSetting).toEqual({ enabled: true });
    expect(canonical.asrConfigs.future).toMatchObject({ region: 'future-region' });
    expect(canonical.embeddingConfigs.future).toMatchObject({
      transport: 'future-transport',
    });
  });

  it('is idempotent and does not mutate its input', () => {
    const input = {
      provider: 'openai',
      groqApiKey: 'legacy-key',
      futureSetting: true,
    };
    const snapshot = structuredClone(input);

    const once = canonicalizeSettings(input);
    expect(canonicalizeSettings(once)).toEqual(once);
    expect(input).toEqual(snapshot);
  });

  it('reports invalid paths without echoing secret values', () => {
    let error: unknown;
    try {
      canonicalizeSettings({ providerApiKeys: { openai: { secret: 'do-not-log' } } });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(SettingsValidationError);
    expect(String(error)).toContain('providerApiKeys.openai');
    expect(String(error)).not.toContain('do-not-log');
  });
});
