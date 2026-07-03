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
 * `resolveAsrConfig` in `lib/storage/settings.ts`. Priority per field:
 * user-filled (`embeddingConfigs`) > `.env.local` (`VITE_EMBEDDING_*`) >
 * provider def. The env bundle is a "default embedding credential" and applies
 * regardless of the active provider. No storage or network access.
 */
export function resolveEmbeddingConfig(settings: UserSettings): ResolvedEmbeddingConfig {
  const providerId = settings.embeddingProvider ?? 'openai';
  const def = getEmbeddingProviderDef(providerId);
  const cfg = settings.embeddingConfigs?.[providerId];

  return {
    providerId,
    apiKey: cfg?.apiKey || (import.meta.env.VITE_EMBEDDING_API_KEY as string) || '',
    baseUrl: cfg?.baseUrl || (import.meta.env.VITE_EMBEDDING_BASE_URL as string) || def.baseUrl,
    model: cfg?.model || (import.meta.env.VITE_EMBEDDING_MODEL as string) || def.defaultModel,
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
