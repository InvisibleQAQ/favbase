import { storage } from 'wxt/utils/storage';
import type { LLMProviderId, ASRProviderId } from './providers';
import { getAsrProviderDef } from './providers';

export interface UserSettings {
  // LLM
  provider: LLMProviderId;
  providerApiKeys: Record<string, string>;
  providerModels: Record<string, string>;
  customBaseUrl: string;
  customModel: string;
  customProtocol: 'openai' | 'claude';

  // ASR
  asrProvider: ASRProviderId;
  asrConfigs: Record<string, { apiKey: string; model: string }>;

  // Mode
  prefMode: 'quality' | 'efficiency';

  // Advanced
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  // LLM
  provider: 'modelscope',
  providerApiKeys: {},
  providerModels: {},
  customBaseUrl: '',
  customModel: '',
  customProtocol: 'openai',

  // ASR
  asrProvider: 'groq',
  asrConfigs: {},

  // Mode
  prefMode: 'efficiency',

  // Advanced
  temperature: 0.3,
  maxTokens: 1000,
};

export const settingsStorage = storage.defineItem<UserSettings>(
  'local:settings',
  { fallback: DEFAULT_SETTINGS },
);

export const sidebarPinnedStorage = storage.defineItem<boolean>(
  'local:sidebarPinned',
  { fallback: true },
);

export function resolveAsrConfig(settings: UserSettings): { apiKey: string; model: string; baseUrl: string } {
  const cfg = settings.asrConfigs?.[settings.asrProvider];
  const def = getAsrProviderDef(settings.asrProvider);
  return {
    apiKey: cfg?.apiKey ?? '',
    model: cfg?.model || def.defaultModel,
    baseUrl: def.baseUrl,
  };
}

/**
 * One-time migration: flat ASR fields -> asrConfigs record.
 * Call from background.ts onInstalled/onStartup. Idempotent.
 */
export async function migrateSettingsIfNeeded(): Promise<void> {
  const raw = await settingsStorage.getValue();

  // Already migrated or fresh install (asrConfigs exists and has entries, or old fields absent)
  if (raw.asrConfigs && Object.keys(raw.asrConfigs).length > 0) return;

  // Check for old flat fields
  const anyRaw = raw as unknown as Record<string, unknown>;
  const hasOldFields =
    anyRaw.groqApiKey || anyRaw.groqModel ||
    anyRaw.siliconFlowApiKey || anyRaw.siliconFlowAsrModel;

  if (!hasOldFields) return; // fresh install, nothing to migrate

  const asrConfigs: Record<string, { apiKey: string; model: string }> = {};

  if (anyRaw.groqApiKey || anyRaw.groqModel) {
    asrConfigs.groq = {
      apiKey: (anyRaw.groqApiKey as string) ?? '',
      model: (anyRaw.groqModel as string) ?? '',
    };
  }
  if (anyRaw.siliconFlowApiKey || anyRaw.siliconFlowAsrModel) {
    asrConfigs.siliconflow = {
      apiKey: (anyRaw.siliconFlowApiKey as string) ?? '',
      model: (anyRaw.siliconFlowAsrModel as string) ?? '',
    };
  }

  await settingsStorage.setValue({ ...raw, asrConfigs });
}
