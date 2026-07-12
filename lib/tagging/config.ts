import type { LLMProviderId } from '@/lib/providers';
import { getProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { settingsStorage, getEnvApiKey, getEnvModel } from '@/lib/storage';

export interface ResolvedTaggingConfig {
  providerId: LLMProviderId;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
  customProtocol?: 'openai' | 'claude';
  enabled: boolean;
}

/**
 * Pure resolver: `UserSettings` → concrete LLM config for tagging. Mirrors
 * `deriveLlmDraft` field resolution (user-filled > env > provider def) and
 * `resolveEmbeddingConfig`'s derived `enabled` — there is no toggle; tagging
 * activates whenever an apiKey + model resolve, so an unconfigured install
 * silently skips tagging instead of erroring.
 */
export function resolveTaggingConfig(settings: UserSettings): ResolvedTaggingConfig {
  const providerId = settings.provider;
  const def = getProviderDef(providerId);
  const apiKey = settings.providerApiKeys[providerId] || getEnvApiKey(providerId);
  const model = settings.providerModels[providerId] || getEnvModel(providerId) || def.defaultModel;

  return {
    providerId,
    apiKey,
    model,
    customBaseUrl: settings.customBaseUrl,
    customProtocol: settings.customProtocol,
    enabled: !!apiKey && !!model,
  };
}

/** Async convenience for non-React consumers. Mirrors `getEmbeddingSettings()`. */
export async function getTaggingConfig(): Promise<ResolvedTaggingConfig> {
  const settings = await settingsStorage.getValue();
  return resolveTaggingConfig(settings);
}
