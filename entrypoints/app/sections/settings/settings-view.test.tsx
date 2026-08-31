// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const settingsState = vi.hoisted(() => ({
  saveLlm: vi.fn(async () => {}),
  saveEmbedding: vi.fn(async () => {}),
}));
const resumeCollectionProcessing = vi.hoisted(() => vi.fn());
const cardProps = vi.hoisted(() => ({
  llm: null as null | { saveLlm: (draft: unknown) => Promise<void> },
  embedding: null as null | { saveEmbedding: (draft: unknown) => Promise<void> },
}));

vi.mock('@/lib/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {},
    saveLlm: settingsState.saveLlm,
    saveAsr: vi.fn(),
    saveEmbedding: settingsState.saveEmbedding,
    saveGithub: vi.fn(),
    saveYoutube: vi.fn(),
  }),
}));
vi.mock('../../hooks/collection-processing-resume', () => ({ resumeCollectionProcessing }));
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
vi.mock('../../components/collection/section-title-bar', () => ({
  SectionTitleBar: ({ title }: { title: ReactNode }) => <h1>{title}</h1>,
}));
vi.mock('./settings-tabs', () => ({
  SettingsTabs: ({
    onChange,
    tabs,
  }: {
    onChange: (value: string) => void;
    tabs: Array<{ value: string }>;
  }) => (
    <div>
      {tabs.map((tab) => (
        <button key={tab.value} type="button" onClick={() => onChange(tab.value)}>
          {tab.value}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./section-rail', () => ({
  SectionRail: ({
    value,
    onChange,
    items,
  }: {
    value: string;
    onChange: (value: string) => void;
    items: Array<{ value: string }>;
  }) => (
    <div>
      <div data-testid="rail-value">{value}</div>
      {items.map((item) => (
        <button key={item.value} type="button" onClick={() => onChange(item.value)}>
          {item.value}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('./llm-config-card', () => ({
  LlmConfigCard: (props: { saveLlm: (draft: unknown) => Promise<void> }) => {
    cardProps.llm = props;
    return <div className="MuiCard-root" data-testid="llm-card" />;
  },
}));
vi.mock('./asr-config-card', () => ({
  AsrConfigCard: () => <div data-testid="asr-card" />,
}));
vi.mock('./embedding/embedding-config-card', () => ({
  EmbeddingConfigCard: (props: { saveEmbedding: (draft: unknown) => Promise<void> }) => {
    cardProps.embedding = props;
    return <div data-testid="embedding-card" />;
  },
}));
vi.mock('./github-connection-card', () => ({ GithubConnectionCard: () => null }));
vi.mock('./youtube-connection-card', () => ({ YoutubeConnectionCard: () => null }));
vi.mock('./agent-bridge-card', () => ({
  AgentBridgeCard: () => <div data-testid="agent-bridge-card" />,
}));
vi.mock('../overview/export-card', () => ({ ExportCard: () => null }));
vi.mock('./webdav-sync-card', () => ({ WebdavSyncCard: () => null }));

import { SettingsView } from './settings-view';

describe('SettingsView deep links', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    settingsState.saveLlm.mockReset().mockResolvedValue(undefined);
    settingsState.saveEmbedding.mockReset().mockResolvedValue(undefined);
    resumeCollectionProcessing.mockReset();
    cardProps.llm = null;
    cardProps.embedding = null;
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

  it('uses the shared route title and keeps settings panels unnested', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('settings.title');
    expect(container.querySelector('.MuiCard-root .MuiCard-root')).toBeNull();
  });

  it.each([
    ['llm', 'llm-card'],
    ['asr', 'asr-card'],
    ['embedding', 'embedding-card'],
  ])('selects AI / %s from a valid section query', (section, card) => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={[`/settings?section=${section}`]}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="rail-value"]')?.textContent).toBe(section);
    expect(container.querySelector(`[data-testid="${card}"]`)).not.toBeNull();
  });

  it('falls back to LLM for an invalid section query', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings?section=unknown']}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('[data-testid="rail-value"]')?.textContent).toBe('llm');
    expect(container.querySelector('[data-testid="llm-card"]')).not.toBeNull();
  });

  it.each([
    ['llm', 'llm'],
    ['embedding', 'embedding'],
  ] as const)('resumes the source platform after a successful %s save', async (section, capability) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/settings?section=${section}&resume=github`]}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    await act(async () => {
      if (section === 'llm') await cardProps.llm?.saveLlm({});
      else await cardProps.embedding?.saveEmbedding({});
    });

    expect(resumeCollectionProcessing).toHaveBeenCalledWith('github', capability);
  });

  it('does not resume after a failed save', async () => {
    settingsState.saveLlm.mockRejectedValueOnce(new Error('save failed'));
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings?section=llm&resume=github']}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    await expect(cardProps.llm?.saveLlm({})).rejects.toThrow('save failed');
    expect(resumeCollectionProcessing).not.toHaveBeenCalled();
  });

  it('ignores an invalid resume platform after a successful save', async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/settings?section=llm&resume=unknown']}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    await cardProps.llm?.saveLlm({});

    expect(settingsState.saveLlm).toHaveBeenCalledOnce();
    expect(resumeCollectionProcessing).not.toHaveBeenCalled();
  });

  it('renders Agent Bridge from the Connections section rail', () => {
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/settings']}>
          <SettingsView />
        </MemoryRouter>,
      );
    });

    const connections = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'connections');
    if (!(connections instanceof HTMLButtonElement)) throw new Error('Connections tab not found');
    act(() => connections.click());

    const agentBridge = [...container.querySelectorAll('button')]
      .find((button) => button.textContent === 'agent-bridge');
    if (!(agentBridge instanceof HTMLButtonElement)) throw new Error('Agent Bridge rail item not found');
    act(() => agentBridge.click());

    expect(container.querySelector('[data-testid="rail-value"]')?.textContent).toBe('agent-bridge');
    expect(container.querySelector('[data-testid="agent-bridge-card"]')).not.toBeNull();
  });
});
