import type { EmbeddingProviderId } from '@/lib/providers';
import { EMBEDDING_PROVIDER_IDS, getEmbeddingProviderDef } from '@/lib/providers';
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
 * user-filled (`embeddingConfigs`, non-empty wins) > `.env.local`
 * (`VITE_EMBEDDING_*`) > provider def. `.env.local` is only a default starting
 * point — the user can override it and their value wins. `providerId`:
 * `settings.embeddingProvider` (which already defaults to `VITE_EMBEDDING_PROVIDER`
 * via `DEFAULT_SETTINGS`) > valid `VITE_EMBEDDING_PROVIDER` > `'openai'`;
 * invalid `VITE_EMBEDDING_PROVIDER` is ignored. def fallbacks for baseUrl/model
 * come from the resolved provider. `enabled` is derived — there is no toggle;
 * semantic search is enabled whenever an apiKey is resolved (user or env), so a
 * fully-unconfigured install silently skips embedding instead of spamming errors.
 * No storage or network access.
 */
export function resolveEmbeddingConfig(settings: UserSettings): ResolvedEmbeddingConfig {
  const envProvider = (import.meta.env.VITE_EMBEDDING_PROVIDER as string) || '';
  const providerId: EmbeddingProviderId =
    settings.embeddingProvider ??
    ((EMBEDDING_PROVIDER_IDS as readonly string[]).includes(envProvider)
      ? (envProvider as EmbeddingProviderId)
      : 'openai');
  const def = getEmbeddingProviderDef(providerId);
  const cfg = settings.embeddingConfigs?.[providerId];

  const apiKey = cfg?.apiKey || (import.meta.env.VITE_EMBEDDING_API_KEY as string) || '';

  return {
    providerId,
    apiKey,
    baseUrl: cfg?.baseUrl || (import.meta.env.VITE_EMBEDDING_BASE_URL as string) || def.baseUrl,
    model: cfg?.model || (import.meta.env.VITE_EMBEDDING_MODEL as string) || def.defaultModel,
    enabled: !!apiKey,
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
