import { describe, expect, it } from 'vitest';

import { deriveConfigurationBlockers } from './configuration-blockers';
import type { ProcessingCoverage } from './processing-coverage';

const coverage: ProcessingCoverage = {
  acquisition: { done: 3, total: null },
  content: { done: 3, total: 3 },
  embedding: { done: 1, total: 3 },
  tagging: { done: 3, total: 3 },
};

describe('deriveConfigurationBlockers', () => {
  it('reports an incomplete Embed backlog only when coverage is readable and Embedding is disabled', () => {
    expect(
      deriveConfigurationBlockers({
        coverage,
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: true,
      }),
    ).toEqual([{ capability: 'embedding', pending: 2 }]);

    expect(
      deriveConfigurationBlockers({
        coverage: null,
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: true,
      }),
    ).toEqual([]);

    expect(
      deriveConfigurationBlockers({
        coverage,
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: true,
        llmConfigured: true,
      }),
    ).toEqual([]);
  });

  it('combines independent Embed and Tags blockers', () => {
    expect(
      deriveConfigurationBlockers({
        coverage: { ...coverage, tagging: { done: 0, total: 3 } },
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: false,
      }),
    ).toEqual([
      { capability: 'embedding', pending: 2 },
      { capability: 'llm', pending: 3 },
    ]);
  });

  it('reports ASR only for the authoritative wait state while ASR remains disabled', () => {
    // The ASR signal is independent of coverage: it survives an unreadable
    // snapshot, because the platform state machine — not a count — raised it.
    const input = {
      coverage: null,
      asrBlocked: true,
      asrConfigured: false,
      embeddingConfigured: false,
      llmConfigured: false,
    };

    expect(deriveConfigurationBlockers(input)).toEqual([{ capability: 'asr' }]);
    expect(deriveConfigurationBlockers({ ...input, asrBlocked: false })).toEqual([]);
    expect(deriveConfigurationBlockers({ ...input, asrConfigured: true })).toEqual([]);
  });

  it('ignores a settled stage and a stage with nothing eligible', () => {
    expect(
      deriveConfigurationBlockers({
        coverage: {
          acquisition: { done: 5, total: null },
          content: { done: 5, total: 5 },
          embedding: { done: 0, total: 0 },
          tagging: { done: 0, total: 0 },
        },
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: false,
      }),
    ).toEqual([]);
  });
});
