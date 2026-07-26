import { useCallback, useEffect, useState } from 'react';
import type { LLMProviderId, ASRProviderId, EmbeddingProviderId } from '@/lib/providers';
import { getProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import {
  settingsStorage,
  DEFAULT_SETTINGS,
  resolveAsrConfig,
  resolveLlmConfig,
  getEnvApiKey,
  getEnvModel,
} from '@/lib/storage';
import { resolveEmbeddingConfig } from '@/lib/embedding/config';

// ---------------------------------------------------------------------------
// Draft shapes + derivation (pure)
//
// Settings cards hold a local draft; nothing touches storage until the user
// clicks Save (gated on a successful connection test). `deriveXxxDraft` is
// the single translation from stored `UserSettings` (per-provider records +
// env fallbacks) to the flat editable shape a card renders.
// ---------------------------------------------------------------------------

export interface LlmDraft {
  provider: LLMProviderId;
  apiKey: string;
  model: string;
  customBaseUrl: string;
  customProtocol: 'openai' | 'claude';
  temperature: number;
  maxTokens: number;
  prefMode: 'quality' | 'efficiency';
}

export interface AsrDraft {
  provider: ASRProviderId;
  apiKey: string;
  model: string;
}

export interface EmbeddingDraft {
  provider: EmbeddingProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number | undefined;
}

/**
 * GitHub is a platform connection, not an AI provider — there is exactly one
 * "provider". The constant `provider: 'github'` field only satisfies the
 * `useConfigDraft` generic constraint (`T extends { provider: string }`).
 */
export interface GithubDraft {
  provider: 'github';
  token: string;
}

export function deriveLlmDraft(settings: UserSettings, provider?: LLMProviderId): LlmDraft {
  const p = provider ?? settings.provider;
  const def = getProviderDef(p);
  return {
    provider: p,
    apiKey: settings.providerApiKeys[p] || getEnvApiKey(p),
    model: settings.providerModels[p] || getEnvModel(p) || def.defaultModel,
    customBaseUrl: settings.customBaseUrl,
    customProtocol: settings.customProtocol,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    prefMode: settings.prefMode,
  };
}

export function deriveAsrDraft(settings: UserSettings, provider?: ASRProviderId): AsrDraft {
  const p = provider ?? settings.asrProvider;
  const resolved = resolveAsrConfig({ ...settings, asrProvider: p });
  return { provider: p, apiKey: resolved.apiKey, model: resolved.model };
}

export function deriveEmbeddingDraft(
  settings: UserSettings,
  provider?: EmbeddingProviderId,
): EmbeddingDraft {
  const p = provider ?? resolveEmbeddingConfig(settings).providerId;
  const resolved = resolveEmbeddingConfig({ ...settings, embeddingProvider: p });
  return {
    provider: p,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model,
    // Raw stored value (not the resolver's filtered one) so the dimensions
    // Select reflects exactly what's stored.
    dimensions: settings.embeddingConfigs?.[p]?.dimensions,
  };
}

export function deriveGithubDraft(settings: UserSettings): GithubDraft {
  return { provider: 'github', token: settings.githubToken ?? '' };
}

/**
 * YouTube is a platform connection (Data API key + channel), not an AI
 * provider — same rationale as GithubDraft: the constant `provider: 'youtube'`
 * field only satisfies the `useConfigDraft` generic constraint. `channel` is
 * raw user input (@handle / UC… id / channel URL); resolution happens at
 * probe/sync time in lib/youtube.
 */
export interface YoutubeDraft {
  provider: 'youtube';
  apiKey: string;
  channel: string;
}

export function deriveYoutubeDraft(settings: UserSettings): YoutubeDraft {
  return {
    provider: 'youtube',
    apiKey: settings.youtubeApiKey ?? '',
    channel: settings.youtubeChannel ?? '',
  };
}

// ---------------------------------------------------------------------------
// useSettings
// ---------------------------------------------------------------------------

export interface UseSettingsReturn {
  settings: UserSettings;
  loading: boolean;

  /** Resolved ASR key for non-settings consumers (content script panel). */
  currentAsrApiKey: string;
  /** Whether an LLM apiKey+model resolve — gates the panel's summary tab. */
  llmConfigured: boolean;

  saveLlm: (draft: LlmDraft) => Promise<void>;
  saveAsr: (draft: AsrDraft) => Promise<void>;
  saveEmbedding: (draft: EmbeddingDraft) => Promise<void>;
  saveGithub: (draft: GithubDraft) => Promise<void>;
  saveYoutube: (draft: YoutubeDraft) => Promise<void>;
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    settingsStorage.getValue().then((val: UserSettings) => {
      if (cancelled) return;
      if (val) setSettings(val);
      setLoading(false);
    });

    const unwatch = settingsStorage.watch((newVal: UserSettings) => {
      if (newVal) setSettings(newVal);
    });

    return () => {
      cancelled = true;
      unwatch();
    };
  }, []);

  // Saves merge onto the freshly-read stored value (not React state) so two
  // sections saving near-simultaneously in different contexts don't clobber
  // each other's fields.
  const persist = useCallback(
    async (patch: (cur: UserSettings) => UserSettings) => {
      const cur = await settingsStorage.getValue();
      const next = patch(cur);
      await settingsStorage.setValue(next);
      setSettings(next);
    },
    [],
  );

  const saveLlm = useCallback(
    (draft: LlmDraft) =>
      persist((cur) => ({
        ...cur,
        provider: draft.provider,
        providerApiKeys: { ...cur.providerApiKeys, [draft.provider]: draft.apiKey },
        providerModels: { ...cur.providerModels, [draft.provider]: draft.model },
        customBaseUrl: draft.customBaseUrl,
        customProtocol: draft.customProtocol,
        temperature: draft.temperature,
        maxTokens: draft.maxTokens,
        prefMode: draft.prefMode,
        configSavedAt: { ...cur.configSavedAt, llm: Date.now() },
      })),
    [persist],
  );

  const saveAsr = useCallback(
    (draft: AsrDraft) =>
      persist((cur) => ({
        ...cur,
        asrProvider: draft.provider,
        asrConfigs: {
          ...cur.asrConfigs,
          [draft.provider]: { apiKey: draft.apiKey, model: draft.model },
        },
        configSavedAt: { ...cur.configSavedAt, asr: Date.now() },
      })),
    [persist],
  );

  const saveEmbedding = useCallback(
    (draft: EmbeddingDraft) =>
      persist((cur) => ({
        ...cur,
        embeddingProvider: draft.provider,
        embeddingConfigs: {
          ...cur.embeddingConfigs,
          [draft.provider]: {
            apiKey: draft.apiKey,
            baseUrl: draft.baseUrl,
            model: draft.model,
            dimensions: draft.dimensions,
          },
        },
        configSavedAt: { ...cur.configSavedAt, embedding: Date.now() },
      })),
    [persist],
  );

  const saveGithub = useCallback(
    (draft: GithubDraft) =>
      persist((cur) => ({
        ...cur,
        githubToken: draft.token,
        configSavedAt: { ...cur.configSavedAt, github: Date.now() },
      })),
    [persist],
  );

  const saveYoutube = useCallback(
    (draft: YoutubeDraft) =>
      persist((cur) => ({
        ...cur,
        youtubeApiKey: draft.apiKey,
        youtubeChannel: draft.channel,
        configSavedAt: { ...cur.configSavedAt, youtube: Date.now() },
      })),
    [persist],
  );

  const currentAsrApiKey = resolveAsrConfig(settings).apiKey;
  const llmConfigured = resolveLlmConfig(settings).enabled;

  return {
    settings,
    loading,
    currentAsrApiKey,
    llmConfigured,
    saveLlm,
    saveAsr,
    saveEmbedding,
    saveGithub,
    saveYoutube,
  };
}
