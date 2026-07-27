// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {},
    saveLlm: vi.fn(),
    saveAsr: vi.fn(),
    saveEmbedding: vi.fn(),
    saveGithub: vi.fn(),
    saveYoutube: vi.fn(),
  }),
}));
vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    preference: 'auto',
    setLocale: vi.fn(),
  }),
}));
vi.mock('../../layouts/dashboard', () => ({
  DashboardContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('./settings-tabs', () => ({
  SettingsTabs: () => null,
}));
vi.mock('./section-rail', () => ({
  SectionRail: ({ value }: { value: string }) => <div data-testid="rail-value">{value}</div>,
}));
vi.mock('./llm-config-card', () => ({
  LlmConfigCard: () => <div data-testid="llm-card" />,
}));
vi.mock('./asr-config-card', () => ({
  AsrConfigCard: () => <div data-testid="asr-card" />,
}));
vi.mock('./embedding/embedding-config-card', () => ({ EmbeddingConfigCard: () => null }));
vi.mock('./github-connection-card', () => ({ GithubConnectionCard: () => null }));
vi.mock('./youtube-connection-card', () => ({ YoutubeConnectionCard: () => null }));
vi.mock('../overview/export-card', () => ({ ExportCard: () => null }));
vi.mock('./webdav-sync-card', () => ({ WebdavSyncCard: () => null }));

import { SettingsView } from './settings-view';

describe('SettingsView deep links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('selects AI / ASR from the section query', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings?section=asr']}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="rail-value"]')?.textContent).toBe('asr');
    expect(container.querySelector('[data-testid="asr-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="llm-card"]')).toBeNull();
  });
});
