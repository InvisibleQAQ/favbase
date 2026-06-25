import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LLMProviderId, ASRProviderId, LLMProviderDef, ASRProviderDef } from '@/lib/providers';
import { getProviderDef, ASR_PROVIDERS } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { settingsStorage, DEFAULT_SETTINGS, resolveAsrConfig } from '@/lib/storage';

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

  updateLlm: (update: LlmUpdate) => void;
  updateAsr: (update: AsrUpdate) => void;
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
  const currentLlmApiKey = settings.providerApiKeys[settings.provider] ?? '';
  const currentLlmModel =
    settings.providerModels[settings.provider] ?? currentProviderDef.defaultModel;
  const isCustomProvider = settings.provider === 'custom';

  // --- ASR computed ---
  const currentAsrDef = useMemo(
    () => ASR_PROVIDERS.find((p) => p.id === settings.asrProvider) ?? ASR_PROVIDERS[0],
    [settings.asrProvider],
  );
  const resolved = resolveAsrConfig(settings);
  const currentAsrApiKey = resolved.apiKey;
  const currentAsrModel = resolved.model;

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

    updateLlm,
    updateAsr,
  };
}
