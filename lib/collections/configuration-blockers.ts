import type { ProcessingCoverage } from './processing-coverage';

/**
 * What a transcription state machine may park its items on (docs/37 D5): a
 * capability word, never a platform id — the Collection page banner and the
 * `getProcessingCoverage` Knowledge Tool read the same value.
 * - `'asr'`: the active ASR provider has no key.
 * - `'platform-tab'`: the platform's own site tab is missing, logged out, on a
 *   verification page, or its signing SDK refused the request. No settings page
 *   fixes it; the user acts on the tab.
 */
export type TranscribePrerequisite = 'asr' | 'platform-tab';

/**
 * A provider capability whose absence stops persisted work from progressing.
 * Doubles as the Settings deep-link section id.
 */
export type ConfigurationCapability = 'asr' | 'embedding' | 'llm';

export interface ConfigurationBlocker {
  /** `'platform-tab'` has no settings page: the fix is a user action on the platform's own tab. */
  capability: ConfigurationCapability | 'platform-tab';
  /** Items waiting on this capability. Absent for 'asr' and 'platform-tab', whose signal is not a count. */
  pending?: number;
}

export interface DeriveConfigurationBlockersInput {
  /**
   * `null` when no coverage is available (still loading, or failed to read).
   * No downstream blocker is derivable then — an unread library must not be
   * reported as a configuration problem.
   */
  coverage: ProcessingCoverage | null;
  /**
   * Authoritative wait signal from the platform's own transcription state
   * machine: the prerequisite its parked items wait for, or `null`. An empty
   * ASR key is not by itself a blocker: nothing is queued on ASR until the
   * machine says so.
   */
  prerequisiteBlocked: TranscribePrerequisite | null;
  asrConfigured: boolean;
  embeddingConfigured: boolean;
  llmConfigured: boolean;
}

/**
 * The single rule for "persisted work is waiting on a provider nobody
 * configured". Shared by the Collection page banner and the
 * `getProcessingCoverage` Knowledge Tool, so a model and the UI never disagree
 * about why a stage sits still — an unconfigured provider reads as "will never
 * progress", not "still working".
 *
 * Pure: it derives from counts and booleans only, so both callers resolve
 * provider state their own way (`useSettings` in the page, a storage read in
 * the Background Service Worker).
 */
export function deriveConfigurationBlockers({
  coverage,
  prerequisiteBlocked,
  asrConfigured,
  embeddingConfigured,
  llmConfigured,
}: DeriveConfigurationBlockersInput): ConfigurationBlocker[] {
  const blockers: ConfigurationBlocker[] = [];
  if (prerequisiteBlocked === 'asr' && !asrConfigured) blockers.push({ capability: 'asr' });
  if (prerequisiteBlocked === 'platform-tab') blockers.push({ capability: 'platform-tab' });
  if (!coverage) return blockers;

  const embeddingPending = (coverage.embedding.total ?? 0) - coverage.embedding.done;
  if (!embeddingConfigured && embeddingPending > 0) {
    blockers.push({ capability: 'embedding', pending: embeddingPending });
  }

  const taggingPending = (coverage.tagging.total ?? 0) - coverage.tagging.done;
  if (!llmConfigured && taggingPending > 0) {
    blockers.push({ capability: 'llm', pending: taggingPending });
  }
  return blockers;
}
