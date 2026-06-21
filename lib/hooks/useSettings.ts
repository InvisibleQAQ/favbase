import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserSettings, LLMProviderDef, ASRProviderDef } from '@/lib/types';
import type { LLMProviderId, ASRProviderId } from '@/lib/providers';
import { getProviderDef, ASR_PROVIDERS } from '@/lib/providers';
import { settingsStorage, DEFAULT_SETTINGS } from '@/lib/storage';

export interface UseSettingsReturn {
  settings: UserSettings;
  loading: boolean;
  saved: boolean;

  // LLM computed
  currentProviderDef: LLMProviderDef;
  currentLlmApiKey: string;
  currentLlmModel: string;
  isCustomProvider: boolean;

  // ASR computed
  currentAsrDef: ASRProviderDef;
  currentAsrApiKey: string;
  currentAsrModel: string;

  // LLM actions
  switchProvider: (id: LLMProviderId) => void;
  updateLlmApiKey: (key: string) => void;
  updateLlmModel: (model: string) => void;
  updateCustomBaseUrl: (url: string) => void;
  updateCustomProtocol: (protocol: 'openai' | 'claude') => void;

  // ASR actions
  switchAsrProvider: (id: ASRProviderId) => void;
  updateAsrApiKey: (key: string) => void;
  updateAsrModel: (model: string) => void;

  // Mode
  updatePrefMode: (mode: 'quality' | 'efficiency') => void;

  // Advanced
  updateTemperature: (value: number) => void;
  updateMaxTokens: (value: number) => void;
}

export function useSettings(): UseSettingsReturn {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);

      saveTimerRef.current = setTimeout(() => {
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
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
  const isGroq = settings.asrProvider === 'groq';
  const currentAsrApiKey = isGroq ? settings.groqApiKey : settings.siliconFlowApiKey;
  const currentAsrModel = isGroq ? settings.groqModel : settings.siliconFlowAsrModel;

  // --- LLM actions ---
  const switchProvider = useCallback(
    (id: LLMProviderId) => updateSettings({ provider: id }),
    [updateSettings],
  );

  const updateLlmApiKey = useCallback(
    (key: string) =>
      updateSettings({
        providerApiKeys: { ...settings.providerApiKeys, [settings.provider]: key },
      }),
    [updateSettings, settings.providerApiKeys, settings.provider],
  );

  const updateLlmModel = useCallback(
    (model: string) =>
      updateSettings({
        providerModels: { ...settings.providerModels, [settings.provider]: model },
      }),
    [updateSettings, settings.providerModels, settings.provider],
  );

  const updateCustomBaseUrl = useCallback(
    (url: string) => updateSettings({ customBaseUrl: url }),
    [updateSettings],
  );

  const updateCustomProtocol = useCallback(
    (protocol: 'openai' | 'claude') => updateSettings({ customProtocol: protocol }),
    [updateSettings],
  );

  // --- ASR actions ---
  const switchAsrProvider = useCallback(
    (id: ASRProviderId) => updateSettings({ asrProvider: id }),
    [updateSettings],
  );

  const updateAsrApiKey = useCallback(
    (key: string) =>
      updateSettings(isGroq ? { groqApiKey: key } : { siliconFlowApiKey: key }),
    [updateSettings, isGroq],
  );

  const updateAsrModel = useCallback(
    (model: string) =>
      updateSettings(isGroq ? { groqModel: model } : { siliconFlowAsrModel: model }),
    [updateSettings, isGroq],
  );

  // --- Mode ---
  const updatePrefMode = useCallback(
    (mode: 'quality' | 'efficiency') => updateSettings({ prefMode: mode }),
    [updateSettings],
  );

  // --- Advanced ---
  const updateTemperature = useCallback(
    (value: number) => updateSettings({ temperature: value }),
    [updateSettings],
  );

  const updateMaxTokens = useCallback(
    (value: number) => updateSettings({ maxTokens: value }),
    [updateSettings],
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

    switchProvider,
    updateLlmApiKey,
    updateLlmModel,
    updateCustomBaseUrl,
    updateCustomProtocol,

    switchAsrProvider,
    updateAsrApiKey,
    updateAsrModel,

    updatePrefMode,

    updateTemperature,
    updateMaxTokens,
  };
}
