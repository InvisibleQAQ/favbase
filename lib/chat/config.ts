import type { LanguageModel } from 'ai';
import { createLanguageModel } from '@/lib/ai';
import { deriveLlmDraft } from '@/lib/hooks/useSettings';
import type { UserSettings } from '@/lib/storage';

/**
 * Resolved chat LLM. The chat assistant reuses the primary LLM configuration
 * (same `deriveLlmDraft` the settings LLM card edits) — there is no dedicated
 * chat provider UI. `enabled` is false when no API key is configured for the
 * active provider, letting the chat view render an empty state.
 */
export type ResolvedChatModel =
  | { enabled: true; model: LanguageModel }
  | { enabled: false };

/**
 * Build the chat `LanguageModel` from stored settings, reusing the primary LLM
 * provider/model/key. Pure derivation — no storage side effects, no hardcoded
 * keys. Returns `{ enabled: false }` when the active provider has no API key.
 */
export function resolveChatModel(settings: UserSettings): ResolvedChatModel {
  const draft = deriveLlmDraft(settings);
  if (!draft.apiKey) return { enabled: false };

  const model = createLanguageModel({
    providerId: draft.provider,
    apiKey: draft.apiKey,
    model: draft.model,
    customBaseUrl: draft.customBaseUrl,
    customProtocol: draft.customProtocol,
  });
  return { enabled: true, model };
}

/**
 * Cheap "is the chat LLM configured" check for the render path — mirrors
 * `resolveChatModel(...).enabled` WITHOUT constructing an SDK model object (which
 * `resolveChatModel` does eagerly). Use this for the view's empty-state gate so a
 * keystroke re-render doesn't instantiate a provider client every time.
 */
export function isChatModelConfigured(settings: UserSettings): boolean {
  return Boolean(deriveLlmDraft(settings).apiKey);
}
