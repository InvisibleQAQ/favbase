import type { ProcessingCoverage } from './processing-coverage';

/**
 * A provider capability whose absence stops persisted work from progressing.
 * Doubles as the Settings deep-link section id.
 */
export type ConfigurationCapability = 'asr' | 'embedding' | 'llm';

export interface ConfigurationBlocker {
  capability: ConfigurationCapability;
  /** Items waiting on this capability. Absent for ASR, whose signal is not a count. */
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
   * Authoritative wait signal from the platform's own state machine. An empty
   * key is not by itself a blocker: nothing is queued on ASR until the machine
   * says so.
   */
  asrBlocked: boolean;
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
  asrBlocked,
  asrConfigured,
  embeddingConfigured,
  llmConfigured,
}: DeriveConfigurationBlockersInput): ConfigurationBlocker[] {
  const blockers: ConfigurationBlocker[] = [];
  if (asrBlocked && !asrConfigured) blockers.push({ capability: 'asr' });
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
