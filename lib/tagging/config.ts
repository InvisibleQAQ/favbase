import type { UserSettings } from '@/lib/storage';
import { settingsStorage } from '@/lib/storage';
// Pure resolver module (no wxt storage side effects) — keeps this file's
// callers testable without stubbing the storage barrel.
import { resolveLlmConfig, type ResolvedLlmConfig } from '@/lib/storage/resolve';

/** Tagging uses the currently selected LLM as-is — no extra knobs. */
export type ResolvedTaggingConfig = ResolvedLlmConfig;

/**
 * Pure resolver: `UserSettings` → concrete LLM config for tagging.
 * Thin alias over the shared `resolveLlmConfig` (same precedence and derived
 * `enabled`); kept as a named export so tagging call sites read domain-first.
 */
export function resolveTaggingConfig(settings: UserSettings): ResolvedTaggingConfig {
  return resolveLlmConfig(settings);
}

/** Async convenience for non-React consumers. Mirrors `getEmbeddingSettings()`. */
export async function getTaggingConfig(): Promise<ResolvedTaggingConfig> {
  const settings = await settingsStorage.getValue();
  return resolveTaggingConfig(settings);
}
