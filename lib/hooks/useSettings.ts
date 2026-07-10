import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LLMProviderId, ASRProviderId, LLMProviderDef, ASRProviderDef, EmbeddingProviderId, EmbeddingProviderDef } from '@/lib/providers';
import { getProviderDef, ASR_PROVIDERS, getEmbeddingProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { settingsStorage, DEFAULT_SETTINGS, resolveAsrConfig, getEnvApiKey, getEnvModel } from '@/lib/storage';
import { resolveEmbeddingConfig } from '@/lib/embedding/config';

export type LlmUpdate =
  | { field: 'provider'; value: LLMProviderId }
  | { field: 'apiKey'; value: string }
  | { field: 'model'; value: string }
  | { field: 'customBaseUrl'; value: string }
  | { field: 'customProtocol'; value: 'openai' | 'claude' }
  | { field: 'temperature'; value: number }
  | { field: 'maxTokens'; value: number }
  | { field: 'prefMode'; value: 'quality' | 'efficiency' };

export type AsrUpdate =
  | { field: 'provider'; value: ASRProviderId }
  | { field: 'apiKey'; value: string }
  | { field: 'model'; value: string };

export type EmbeddingUpdate =
  | { field: 'provider'; value: EmbeddingProviderId }
  | { field: 'apiKey'; value: string }
  | { field: 'baseUrl'; value: string }
  | { field: 'model'; value: string }
  | { field: 'dimensions'; value: number | undefined };

export interface UseSettingsReturn {
  settings: UserSettings;
  loading: boolean;
  saved: boolean;

  currentProviderDef: LLMProviderDef;
  currentLlmApiKey: string;
  currentLlmModel: string;
  isCustomProvider: boolean;

  currentAsrDef: ASRProviderDef;
  currentAsrApiKey: string;
  currentAsrModel: string;

  currentEmbeddingDef: EmbeddingProviderDef;
  currentEmbeddingApiKey: string;
  currentEmbeddingBaseUrl: string;
  currentEmbeddingModel: string;
  /**
   * RAW user-entered dimensions (may be invalid — the input needs it to render
   * the error state). Embed consumers use `resolveEmbeddingConfig(...).dimensions`,
   * which filters invalid values to undefined.
   */
  currentEmbeddingDimensions: number | undefined;

  updateLlm: (update: LlmUpdate) => void;
  updateAsr: (update: AsrUpdate) => void;
  updateEmbedding: (update: EmbeddingUpdate) => void;
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<UserSettings | null>(null);

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

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      pendingRef.current = next;

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
        pendingRef.current = null;
        settingsStorage.setValue(next).then(() => {
          setSaved(true);
          if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
          savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
        });
      }, 500);

      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        if (pendingRef.current) settingsStorage.setValue(pendingRef.current);
      }
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    };
  }, []);

  // --- LLM computed ---
  const currentProviderDef = useMemo(
    () => getProviderDef(settings.provider),
    [settings.provider],
  );
  const currentLlmApiKey = settings.providerApiKeys[settings.provider] || getEnvApiKey(settings.provider);
  const currentLlmModel =
    settings.providerModels[settings.provider] || getEnvModel(settings.provider) || currentProviderDef.defaultModel;
  const isCustomProvider = settings.provider === 'custom';

  // --- ASR computed ---
  const currentAsrDef = useMemo(
    () => ASR_PROVIDERS.find((p) => p.id === settings.asrProvider) ?? ASR_PROVIDERS[0],
    [settings.asrProvider],
  );
  const resolved = resolveAsrConfig(settings);
  const currentAsrApiKey = resolved.apiKey;
  const currentAsrModel = resolved.model;

  // --- Embedding computed ---
  // Mirror ASR: derive UI values from the pure resolver so env (VITE_EMBEDDING_*)
  // shows through as the default starting point until the user overrides a field.
  const resolvedEmbedding = resolveEmbeddingConfig(settings);
  const embeddingProvider = resolvedEmbedding.providerId;
  const currentEmbeddingDef = useMemo(
    () => getEmbeddingProviderDef(embeddingProvider),
    [embeddingProvider],
  );
  const currentEmbeddingApiKey = resolvedEmbedding.apiKey;
  const currentEmbeddingBaseUrl = resolvedEmbedding.baseUrl;
  const currentEmbeddingModel = resolvedEmbedding.model;
  // Raw (unfiltered) so the UI can render the invalid-input error state;
  // resolveEmbeddingConfig would silently drop e.g. 0 or -5.
  const currentEmbeddingDimensions =
    settings.embeddingConfigs?.[embeddingProvider]?.dimensions;

  // --- LLM action ---
  const updateLlm = useCallback(
    (update: LlmUpdate) => {
      switch (update.field) {
        case 'provider':
          return updateSettings({ provider: update.value });
        case 'apiKey':
          return updateSettings({
            providerApiKeys: { ...settings.providerApiKeys, [settings.provider]: update.value },
          });
        case 'model':
          return updateSettings({
            providerModels: { ...settings.providerModels, [settings.provider]: update.value },
          });
        case 'customBaseUrl':
          return updateSettings({ customBaseUrl: update.value });
        case 'customProtocol':
          return updateSettings({ customProtocol: update.value });
        case 'temperature':
          return updateSettings({ temperature: update.value });
        case 'maxTokens':
          return updateSettings({ maxTokens: update.value });
        case 'prefMode':
          return updateSettings({ prefMode: update.value });
      }
    },
    [updateSettings, settings.providerApiKeys, settings.providerModels, settings.provider],
  );

  // --- ASR action ---
  const updateAsr = useCallback(
    (update: AsrUpdate) => {
      switch (update.field) {
        case 'provider':
          return updateSettings({ asrProvider: update.value });
        case 'apiKey': {
          const cur = settings.asrConfigs?.[settings.asrProvider] ?? { apiKey: '', model: '' };
          return updateSettings({
            asrConfigs: { ...settings.asrConfigs, [settings.asrProvider]: { ...cur, apiKey: update.value } },
          });
        }
        case 'model': {
          const cur = settings.asrConfigs?.[settings.asrProvider] ?? { apiKey: '', model: '' };
          return updateSettings({
            asrConfigs: { ...settings.asrConfigs, [settings.asrProvider]: { ...cur, model: update.value } },
          });
        }
      }
    },
    [updateSettings, settings.asrConfigs, settings.asrProvider],
  );

  // --- Embedding action ---
  const updateEmbedding = useCallback(
    (update: EmbeddingUpdate) => {
      switch (update.field) {
        case 'provider':
          return updateSettings({ embeddingProvider: update.value });
        case 'apiKey': {
          const cur = settings.embeddingConfigs?.[embeddingProvider] ?? { apiKey: '' };
          return updateSettings({
            embeddingConfigs: { ...settings.embeddingConfigs, [embeddingProvider]: { ...cur, apiKey: update.value } },
          });
        }
        case 'baseUrl': {
          const cur = settings.embeddingConfigs?.[embeddingProvider] ?? { apiKey: '' };
          return updateSettings({
            embeddingConfigs: { ...settings.embeddingConfigs, [embeddingProvider]: { ...cur, baseUrl: update.value } },
          });
        }
        case 'model': {
          const cur = settings.embeddingConfigs?.[embeddingProvider] ?? { apiKey: '' };
          return updateSettings({
            embeddingConfigs: { ...settings.embeddingConfigs, [embeddingProvider]: { ...cur, model: update.value } },
          });
        }
        case 'dimensions': {
          const cur = settings.embeddingConfigs?.[embeddingProvider] ?? { apiKey: '' };
          return updateSettings({
            embeddingConfigs: { ...settings.embeddingConfigs, [embeddingProvider]: { ...cur, dimensions: update.value } },
          });
        }
      }
    },
    [updateSettings, settings.embeddingConfigs, embeddingProvider],
  );

  return {
    settings,
    loading,
    saved,

    currentProviderDef,
    currentLlmApiKey,
    currentLlmModel,
    isCustomProvider,

    currentAsrDef,
    currentAsrApiKey,
    currentAsrModel,

    currentEmbeddingDef,
    currentEmbeddingApiKey,
    currentEmbeddingBaseUrl,
    currentEmbeddingModel,
    currentEmbeddingDimensions,

    updateLlm,
    updateAsr,
    updateEmbedding,
  };
}
