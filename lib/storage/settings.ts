import { storage } from 'wxt/utils/storage';
import type { LLMProviderId, ASRProviderId, EmbeddingProviderId } from '../providers';
import { getAsrProviderDef } from '../providers';
import { STORAGE_KEYS } from './keys';

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

  // Embedding (semantic search)
  embeddingEnabled: boolean;
  embeddingProvider: EmbeddingProviderId;
  embeddingConfigs: Record<string, { apiKey: string; baseUrl?: string; model?: string }>;

  // Mode
  prefMode: 'quality' | 'efficiency';

  // Advanced
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  // LLM
  provider: (import.meta.env.VITE_LLM_PROVIDER as LLMProviderId) || 'modelscope',
  providerApiKeys: {},
  providerModels: {},
  customBaseUrl: (import.meta.env.VITE_LLM_BASE_URL as string) || '',
  customModel: '',
  customProtocol: (import.meta.env.VITE_LLM_PROTOCOL as 'openai' | 'claude') || 'openai',

  // ASR
  asrProvider: (import.meta.env.VITE_ASR_PROVIDER as ASRProviderId) || 'groq',
  asrConfigs: {},

  // Embedding (semantic search)
  embeddingEnabled: false,
  embeddingProvider: 'openai',
  embeddingConfigs: {},

  // Mode
  prefMode: 'efficiency',

  // Advanced
  temperature: 0.3,
  maxTokens: 1000,
};

export const settingsStorage = storage.defineItem<UserSettings>(
  STORAGE_KEYS.settings,
  { fallback: DEFAULT_SETTINGS },
);

export function getEnvApiKey(providerId: string): string {
  const key = `VITE_${providerId.toUpperCase()}_API_KEY`;
  return (import.meta.env[key] as string) ?? '';
}

export function getEnvModel(providerId: string): string {
  const key = `VITE_${providerId.toUpperCase()}_MODEL`;
  return (import.meta.env[key] as string) ?? '';
}

export function resolveAsrConfig(settings: UserSettings): { apiKey: string; model: string; baseUrl: string } {
  const cfg = settings.asrConfigs?.[settings.asrProvider];
  const def = getAsrProviderDef(settings.asrProvider);
  return {
    apiKey: cfg?.apiKey || getEnvApiKey(settings.asrProvider),
    model: cfg?.model || getEnvModel(settings.asrProvider) || def.defaultModel,
    baseUrl: def.baseUrl,
  };
}

export async function getAsrSettings(): Promise<{ apiKey: string; model: string; baseUrl: string }> {
  const settings = await settingsStorage.getValue();
  return resolveAsrConfig(settings);
}

export async function migrateSettingsIfNeeded(): Promise<void> {
  const raw = await settingsStorage.getValue();

  if (raw.asrConfigs && Object.keys(raw.asrConfigs).length > 0) return;

  const anyRaw = raw as unknown as Record<string, unknown>;
  const hasOldFields =
    anyRaw.groqApiKey || anyRaw.groqModel ||
    anyRaw.siliconFlowApiKey || anyRaw.siliconFlowAsrModel;

  if (!hasOldFields) return;

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
