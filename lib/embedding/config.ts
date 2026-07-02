import type { EmbeddingProviderId } from '@/lib/providers';
import { getEmbeddingProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import { settingsStorage } from '@/lib/storage';

export interface ResolvedEmbeddingConfig {
  providerId: EmbeddingProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
}

/**
 * Pure resolver: `UserSettings` → concrete embedding config. Mirrors
 * `resolveAsrConfig` in `lib/storage/settings.ts`. Fills gaps from the provider
 * def (baseUrl / defaultModel). No storage or network access.
 */
export function resolveEmbeddingConfig(settings: UserSettings): ResolvedEmbeddingConfig {
  const providerId = settings.embeddingProvider ?? 'openai';
  const def = getEmbeddingProviderDef(providerId);
  const cfg = settings.embeddingConfigs?.[providerId];

  return {
    providerId,
    apiKey: cfg?.apiKey ?? '',
    baseUrl: cfg?.baseUrl || def.baseUrl,
    model: cfg?.model || def.defaultModel,
    enabled: settings.embeddingEnabled ?? false,
  };
}

/**
 * Async convenience for non-React consumers (background / offscreen). Cohesive
 * getValue + resolve, mirrors `getAsrSettings()`.
 */
export async function getEmbeddingSettings(): Promise<ResolvedEmbeddingConfig> {
  const settings = await settingsStorage.getValue();
  return resolveEmbeddingConfig(settings);
}
