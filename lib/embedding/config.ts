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

/** Parse a boolean-ish env value; `undefined` when unset/unrecognized. */
function parseEnvBool(raw: string | undefined): boolean | undefined {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

/**
 * Pure resolver: `UserSettings` → concrete embedding config. Mirrors
 * `resolveAsrConfig` in `lib/storage/settings.ts`. Priority per field:
 * `.env.local` (`VITE_EMBEDDING_*`, non-empty wins) > user-filled
 * (`embeddingConfigs`) > provider def. `VITE_EMBEDDING_PROVIDER` must be a
 * valid `EmbeddingProviderId` (invalid values are ignored, falling through to
 * the settings chain); def fallbacks for baseUrl/model come from the resolved
 * provider. `VITE_EMBEDDING_ENABLE` is a hard override (`true`/`1` on,
 * `false`/`0` off, case-insensitive); when unset the settings toggle applies.
 * No storage or network access.
 */
export function resolveEmbeddingConfig(settings: UserSettings): ResolvedEmbeddingConfig {
  const envProvider = (import.meta.env.VITE_EMBEDDING_PROVIDER as string) || '';
  const providerId: EmbeddingProviderId = (EMBEDDING_PROVIDER_IDS as readonly string[]).includes(
    envProvider,
  )
    ? (envProvider as EmbeddingProviderId)
    : (settings.embeddingProvider ?? 'openai');
  const def = getEmbeddingProviderDef(providerId);
  const cfg = settings.embeddingConfigs?.[providerId];
  const envEnabled = parseEnvBool(import.meta.env.VITE_EMBEDDING_ENABLE as string | undefined);

  return {
    providerId,
    apiKey: (import.meta.env.VITE_EMBEDDING_API_KEY as string) || cfg?.apiKey || '',
    baseUrl: (import.meta.env.VITE_EMBEDDING_BASE_URL as string) || cfg?.baseUrl || def.baseUrl,
    model: (import.meta.env.VITE_EMBEDDING_MODEL as string) || cfg?.model || def.defaultModel,
    enabled: envEnabled ?? settings.embeddingEnabled ?? false,
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
