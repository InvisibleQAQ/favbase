import type { UserSettings } from '@/lib/storage';
import { settingsStorage } from '@/lib/storage';
import { resolveLlmConfig, type ResolvedLlmConfig } from '@/lib/storage/resolve';

/**
 * Summary config = the shared LLM config + generation temperature.
 *
 * `settings.temperature` gets its first real consumer here (it and `maxTokens`
 * shipped with the settings page but were never read). `maxTokens` stays
 * unconsumed on purpose: its default (100000) is an input-budget-sized number,
 * and forwarding it as `maxOutputTokens` would 400 on most models.
 */
export interface ResolvedSummaryConfig extends ResolvedLlmConfig {
  temperature: number;
}

export function resolveSummaryConfig(settings: UserSettings): ResolvedSummaryConfig {
  return {
    ...resolveLlmConfig(settings),
    temperature: settings.temperature,
  };
}

/** Async convenience for non-React consumers (background SW). */
export async function getSummaryConfig(): Promise<ResolvedSummaryConfig> {
  const settings = await settingsStorage.getValue();
  return resolveSummaryConfig(settings);
}
