// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProcessingCoverage } from '@/lib/collections';

import { ThemeProvider } from '../../theme/theme-provider';
import { CollectionConfigurationNotice } from './collection-configuration-notice';

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
      params?.count != null
        ? `${key}:${params.count}`
        : params?.platform != null
          ? `${key}:${params.platform}`
          : key,
  }),
}));

const coverage: ProcessingCoverage = {
  acquisition: { done: 3, total: null },
  content: { done: 3, total: 3 },
  embedding: { done: 1, total: 3 },
  tagging: { done: 3, total: 3 },
};

describe('CollectionConfigurationNotice', () => {
  // Reset here, not after each case's assertions: a failing assertion would
  // skip an inline reset and leak a configured provider into the next case.
  beforeEach(() => {
    configState.asr = false;
    configState.embedding = false;
    configState.llm = false;
    configState.loading = false;
  });

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
        '/settings/ai/embedding?resume=github',
        '/settings/ai/llm?resume=github',
      ]);

    act(() => root.unmount());
    container.remove();
  });

  it("renders a platform-tab prerequisite as one status line naming the platform, with no settings link", () => {
    configState.asr = true;
    configState.embedding = true;
    configState.llm = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter>
            <CollectionConfigurationNotice
              platform="douyin"
              coverage={coverage}
              coverageStatus="ready"
              prerequisiteBlocked="platform-tab"
            />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });

    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    // The platform's display name is a parameter, never a literal in this component.
    expect(container.textContent).toContain('configurationBlocker.platformTab:nav.douyinFavorites');
    expect(container.querySelectorAll('a')).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
  });

  it('renders the ASR prerequisite with its settings link while ASR is unconfigured', () => {
    configState.embedding = true;
    configState.llm = true;
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter>
            <CollectionConfigurationNotice
              platform="bilibili"
              coverage={coverage}
              coverageStatus="ready"
              prerequisiteBlocked="asr"
            />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });

    expect(container.textContent).toContain('configurationBlocker.asr');
    expect(Array.from(container.querySelectorAll('a')).map((link) => link.getAttribute('href')))
      .toEqual(['/settings/ai/asr?resume=bilibili']);

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
