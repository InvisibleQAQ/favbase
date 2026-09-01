import type { EmbeddingProviderId } from '@/lib/providers';
import { EMBEDDING_PROVIDER_IDS, getEmbeddingProviderDef } from '@/lib/providers';
// Storage leaf, not the `@/lib/storage` barrel: the barrel also evaluates the
// `ui-state` / `agent-bridge` items, and this module is statically reachable
// from the Background Agent Bridge tool registry (a Service Worker may not use
// dynamic `import()`), so its load-time footprint has to stay minimal.
import type { UserSettings } from '@/lib/storage/settings';
import { settingsStorage } from '@/lib/storage/settings';

export interface ResolvedEmbeddingConfig {
  providerId: EmbeddingProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  /**
   * Optional output truncation (Matryoshka), forwarded to providers that
   * support it. `undefined` = model native dimension. Single source: the
   * user's `embeddingConfigs[providerId].dimensions` — no env fallback, no
   * provider-def fallback. Only finite numbers > 0 pass through; anything
   * else resolves to `undefined` (the UI shows the error state separately).
   */
  dimensions?: number;
}

/**
 * Pure resolver: `UserSettings` → concrete embedding config. Mirrors
 * `resolveAsrConfig` in `lib/storage/settings.ts`. Priority per field:
 * user-filled (`embeddingConfigs`, non-empty wins) > `.env.local`
 * (`VITE_EMBEDDING_*`) > provider def. `.env.local` is only a default starting
 * point — the user can override it and their value wins.
 *
 * The `.env.local` credential bundle (`VITE_EMBEDDING_API_KEY/BASE_URL/MODEL`)
 * describes a SINGLE provider — the one named by `VITE_EMBEDDING_PROVIDER`. It is
 * gated to that provider: env values only seed the resolved config when
 * `providerId === envProvider`; for any other provider the env fields are treated
 * as empty and resolution falls back to the provider def (so a provider the user
 * switches to in the UI does NOT inherit gptgod's baseUrl/model/key). This
 * integrates cleanly because `DEFAULT_SETTINGS.embeddingProvider =
 * VITE_EMBEDDING_PROVIDER || 'openai'`, so a fresh install has
 * `providerId === envProvider` and the env bundle applies to the designated
 * provider; once the user switches providers it no longer matches → no leak.
 *
 * `providerId`: `settings.embeddingProvider` (which already defaults to
 * `VITE_EMBEDDING_PROVIDER` via `DEFAULT_SETTINGS`) > valid
 * `VITE_EMBEDDING_PROVIDER` > `'openai'`; invalid `VITE_EMBEDDING_PROVIDER` is
 * ignored. def fallbacks for baseUrl/model come from the resolved provider.
 * `enabled` is derived — there is no toggle; semantic search is enabled whenever
 * an apiKey is resolved (user or env), so a fully-unconfigured install (or a
 * provider with no user key that isn't the env-designated one) silently skips
 * embedding instead of spamming errors. No storage or network access.
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

  // env bundle only applies to the provider it was configured for.
  const isEnvProvider = providerId === envProvider;
  const env = isEnvProvider
    ? {
        apiKey: (import.meta.env.VITE_EMBEDDING_API_KEY as string) || '',
        baseUrl: (import.meta.env.VITE_EMBEDDING_BASE_URL as string) || '',
        model: (import.meta.env.VITE_EMBEDDING_MODEL as string) || '',
      }
    : { apiKey: '', baseUrl: '', model: '' };

  const apiKey = cfg?.apiKey || env.apiKey;

  // dimensions has exactly one source: explicit user config. Filter invalid
  // values (non-number / NaN / Infinity / <= 0) to undefined so downstream
  // embed calls fall back to the model's native dimension.
  const rawDimensions = cfg?.dimensions;
  const dimensions =
    typeof rawDimensions === 'number' && Number.isFinite(rawDimensions) && rawDimensions > 0
      ? rawDimensions
      : undefined;

  return {
    providerId,
    apiKey,
    baseUrl: cfg?.baseUrl || env.baseUrl || def.baseUrl,
    model: cfg?.model || env.model || def.defaultModel,
    enabled: !!apiKey,
    dimensions,
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
