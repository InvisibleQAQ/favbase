// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import type { ProcessingCoverage } from '@/lib/collections';

import { ThemeProvider } from '../../theme/theme-provider';
import {
  CollectionConfigurationNotice,
  deriveConfigurationBlockers,
} from './collection-configuration-notice';

const configState = vi.hoisted(() => ({
  asr: false,
  embedding: false,
  llm: false,
  loading: false,
}));

vi.mock('@/lib/hooks/useSettings', () => ({
  useSettings: () => ({ settings: configState, loading: configState.loading }),
}));
vi.mock('@/lib/storage/resolve', () => ({
  resolveAsrConfig: () => ({ apiKey: configState.asr ? 'configured' : '' }),
  resolveLlmConfig: () => ({ enabled: configState.llm }),
}));
vi.mock('@/lib/embedding/config', () => ({
  resolveEmbeddingConfig: () => ({ enabled: configState.embedding }),
}));
vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params?.count == null ? key : `${key}:${params.count}`,
  }),
}));

const coverage: ProcessingCoverage = {
  acquisition: { done: 3, total: null },
  content: { done: 3, total: 3 },
  embedding: { done: 1, total: 3 },
  tagging: { done: 3, total: 3 },
};

describe('deriveConfigurationBlockers', () => {
  it('reports an incomplete Embed backlog only when coverage is ready and Embedding is disabled', () => {
    expect(
      deriveConfigurationBlockers({
        coverage,
        coverageStatus: 'ready',
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: true,
      }),
    ).toEqual([{ capability: 'embedding', pending: 2 }]);

    expect(
      deriveConfigurationBlockers({
        coverage,
        coverageStatus: 'loading',
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: true,
      }),
    ).toEqual([]);

    expect(
      deriveConfigurationBlockers({
        coverage,
        coverageStatus: 'error',
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: true,
      }),
    ).toEqual([]);

    expect(
      deriveConfigurationBlockers({
        coverage,
        coverageStatus: 'ready',
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
        coverage: {
          ...coverage,
          tagging: { done: 0, total: 3 },
        },
        coverageStatus: 'ready',
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
    const input = {
      coverage,
      coverageStatus: 'loading' as const,
      asrBlocked: true,
      asrConfigured: false,
      embeddingConfigured: false,
      llmConfigured: false,
    };

    expect(deriveConfigurationBlockers(input)).toEqual([{ capability: 'asr' }]);
    expect(deriveConfigurationBlockers({ ...input, asrBlocked: false })).toEqual([]);
    expect(deriveConfigurationBlockers({ ...input, asrConfigured: true })).toEqual([]);
  });
});

describe('CollectionConfigurationNotice', () => {
  it('renders one passive status banner with a platform-scoped settings link for every blocker', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
        <MemoryRouter>
          <CollectionConfigurationNotice
            platform="github"
            coverage={{ ...coverage, tagging: { done: 0, total: 3 } }}
            coverageStatus="ready"
          />
        </MemoryRouter>
        </ThemeProvider>,
      );
    });

    // A banner that describes the library, not an alert: no live region
    // interrupts page load.
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.textContent).toContain('configurationBlocker.title');
    expect(container.textContent).toContain('configurationBlocker.embedding:2');
    expect(container.textContent).toContain('configurationBlocker.llm:3');
    expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href')))
      .toEqual([
        '/settings?section=embedding&resume=github',
        '/settings?section=llm&resume=github',
      ]);

    act(() => root.unmount());
    container.remove();
  });

  it('does not infer blockers from default settings while saved settings are loading', () => {
    configState.loading = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
        <MemoryRouter>
          <CollectionConfigurationNotice
            platform="github"
            coverage={coverage}
            coverageStatus="ready"
          />
        </MemoryRouter>
        </ThemeProvider>,
      );
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();

    act(() => root.unmount());
    container.remove();
    configState.loading = false;
  });
});
