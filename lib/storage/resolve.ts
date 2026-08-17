/**
 * Pure settings resolvers — `UserSettings` → concrete per-domain config.
 *
 * Deliberately free of `wxt/utils/storage`: `settings.ts` calls
 * `storage.defineItem` at module load (which touches chrome.runtime), so
 * domain configs that only need the pure math import from here and keep their
 * tests free of storage stubs. `settings.ts` re-exports everything below, so
 * `@/lib/storage` stays the public import surface.
 */

import type { LLMProviderId } from '../providers';
import { getAsrProviderDef, getProviderDef } from '../providers';
import type { UserSettings } from './settings-schema';

export function getEnvApiKey(providerId: string): string {
  const key = `VITE_${providerId.toUpperCase()}_API_KEY`;
  return (import.meta.env[key] as string) ?? '';
}

export function getEnvModel(providerId: string): string {
  const key = `VITE_${providerId.toUpperCase()}_MODEL`;
  return (import.meta.env[key] as string) ?? '';
}

/**
 * The currently selected LLM, resolved to concrete credentials.
 * Single source of truth for every LLM consumer (tagging, summary, …) —
 * field precedence is user-filled > env > provider default, mirroring
 * `deriveLlmDraft` in the settings page.
 *
 * `enabled` is derived, not a toggle: an install without apiKey+model simply
 * skips LLM features instead of erroring.
 */
export interface ResolvedLlmConfig {
  providerId: LLMProviderId;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
  customProtocol?: 'openai' | 'claude';
  enabled: boolean;
}

export function resolveLlmConfig(settings: UserSettings): ResolvedLlmConfig {
  const providerId = settings.provider;
  const def = getProviderDef(providerId);
  const apiKey = settings.providerApiKeys[providerId] || getEnvApiKey(providerId);
  const model =
    settings.providerModels[providerId] || getEnvModel(providerId) || def.defaultModel;

  return {
    providerId,
    apiKey,
    model,
    customBaseUrl: settings.customBaseUrl,
    customProtocol: settings.customProtocol,
    enabled: !!apiKey && !!model,
  };
}

export function resolveAsrConfig(
  settings: UserSettings,
): { apiKey: string; model: string; baseUrl: string } {
  const cfg = settings.asrConfigs?.[settings.asrProvider];
  const def = getAsrProviderDef(settings.asrProvider);
  return {
    apiKey: cfg?.apiKey || getEnvApiKey(settings.asrProvider),
    model: cfg?.model || getEnvModel(settings.asrProvider) || def.defaultModel,
    baseUrl: def.baseUrl,
  };
}
