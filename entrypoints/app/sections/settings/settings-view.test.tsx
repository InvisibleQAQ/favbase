// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactNode } from 'react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router-dom';
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
const titleBarProps = vi.hoisted(() => ({
  links: null as null | Array<{ name?: string; href?: string }>,
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
  SectionTitleBar: ({
    title,
    links,
  }: {
    title: ReactNode;
    links?: Array<{ name?: string; href?: string }>;
  }) => {
    titleBarProps.links = links ?? null;
    return <h1>{title}</h1>;
  },
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
vi.mock('./github-connection-card', () => ({
  GithubConnectionCard: () => <div data-testid="github-card" />,
}));
vi.mock('./youtube-connection-card', () => ({
  YoutubeConnectionCard: () => <div data-testid="youtube-card" />,
}));
vi.mock('./agent-bridge-card', () => ({
  AgentBridgeCard: () => <div data-testid="agent-bridge-card" />,
}));
vi.mock('../overview/export-card', () => ({
  ExportCard: () => <div data-testid="export-card" />,
}));
vi.mock('./webdav-sync-card', () => ({
  WebdavSyncCard: () => <div data-testid="webdav-card" />,
}));

import { SettingsView } from './settings-view';

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

describe('SettingsView routing', () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;

  // The route pattern is the one main.tsx registers. Mounting through a real
  // router (not a bare MemoryRouter) is the point: it is what proves the
  // optional `:tab?/:section?` segments actually match `/settings`, a bare tab
  // and a full leaf, and it lets the redirects be read off the location.
  function renderAt(entry: string) {
    router = createMemoryRouter(
      [
        {
          path: '/settings/:tab?/:section?',
          element: (
            <>
              <SettingsView />
              <LocationProbe />
            </>
          ),
        },
      ],
      { initialEntries: [entry] },
    );
    act(() => {
      root.render(<RouterProvider router={router} />);
    });
  }

  const location = () => container.querySelector('[data-testid="location"]')?.textContent;
  const railValue = () => container.querySelector('[data-testid="rail-value"]')?.textContent;
  const click = (label: string) => {
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
    if (!(button instanceof HTMLButtonElement)) throw new Error(`no button: ${label}`);
    act(() => button.click());
  };

  beforeEach(() => {
    settingsState.saveLlm.mockReset().mockResolvedValue(undefined);
    settingsState.saveEmbedding.mockReset().mockResolvedValue(undefined);
    resumeCollectionProcessing.mockReset();
    cardProps.llm = null;
    cardProps.embedding = null;
    titleBarProps.links = null;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each([
    ['/settings/ai/llm', 'llm', 'llm-card'],
    ['/settings/ai/asr', 'asr', 'asr-card'],
    ['/settings/ai/embedding', 'embedding', 'embedding-card'],
    ['/settings/connections/github', 'github', 'github-card'],
    ['/settings/connections/youtube', 'youtube', 'youtube-card'],
    ['/settings/connections/agent-bridge', 'agent-bridge', 'agent-bridge-card'],
    ['/settings/storage/export', 'export', 'export-card'],
    ['/settings/storage/webdav', 'webdav', 'webdav-card'],
  ])('renders %s directly', (path, section, card) => {
    renderAt(path);

    expect(location()).toBe(path);
    expect(railValue()).toBe(section);
    expect(container.querySelector(`[data-testid="${card}"]`)).not.toBeNull();
  });

  it('renders the language section, which has no card of its own', () => {
    renderAt('/settings/general/language');

    expect(location()).toBe('/settings/general/language');
    expect(railValue()).toBe('language');
    expect(container.querySelector('.MuiSelect-root, [role="combobox"]')).not.toBeNull();
  });

  it.each([
    ['/settings', '/settings/ai/llm'],
    ['/settings/connections', '/settings/connections/github'],
    ['/settings/storage', '/settings/storage/export'],
    ['/settings/nonsense', '/settings/ai/llm'],
    ['/settings/ai/nonsense', '/settings/ai/llm'],
  ])('redirects %s to %s', (entry, expected) => {
    renderAt(entry);

    expect(location()).toBe(expected);
  });

  it('redirects without leaving the bare path in history', async () => {
    renderAt('/settings');
    expect(location()).toBe('/settings/ai/llm');

    // A redirect that pushed would send Back to `/settings`, which would
    // redirect forward again and trap the user on the settings page.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it.each([
    ['asr', '/settings/ai/asr'],
    ['embedding', '/settings/ai/embedding'],
  ])('upgrades the legacy ?section=%s bookmark', (section, expected) => {
    renderAt(`/settings?section=${section}`);

    // The query is consumed by the redirect, not carried into the new URL.
    expect(location()).toBe(expected);
    expect(railValue()).toBe(section);
  });

  it('keeps ?resume= while upgrading a legacy bookmark', () => {
    renderAt('/settings?section=embedding&resume=github');

    expect(location()).toBe('/settings/ai/embedding?resume=github');
  });

  it('falls back to the default leaf for an unknown legacy section', () => {
    renderAt('/settings?section=unknown');

    expect(location()).toBe('/settings/ai/llm');
    expect(railValue()).toBe('llm');
  });

  it('pushes rail navigation so Back walks section by section', async () => {
    renderAt('/settings/ai/llm');

    click('connections');
    expect(location()).toBe('/settings/connections/github');

    click('agent-bridge');
    expect(location()).toBe('/settings/connections/agent-bridge');

    await act(async () => {
      await router.navigate(-1);
    });
    expect(location()).toBe('/settings/connections/github');
  });

  it('lands on a tab first section rather than the one last seen there', () => {
    renderAt('/settings/connections/agent-bridge');

    click('ai');
    expect(location()).toBe('/settings/ai/llm');

    click('connections');
    // URL is the only source of truth: no remembered per-tab section.
    expect(location()).toBe('/settings/connections/github');
  });

  it('carries ?resume= across manual navigation', () => {
    renderAt('/settings/ai/llm?resume=github');

    click('embedding');
    expect(location()).toBe('/settings/ai/embedding?resume=github');
  });

  it('uses the shared route title and keeps settings panels unnested', () => {
    renderAt('/settings');

    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('settings.title');
    expect(container.querySelector('.MuiCard-root .MuiCard-root')).toBeNull();
  });

  it('hands the shared title bar a Home -> Settings trail', () => {
    renderAt('/settings/connections/agent-bridge');

    // The rendered `nav` and its `aria-current="page"` crumb are locked by
    // custom-breadcrumbs.test.tsx and section-title-bar.test.tsx; the only
    // thing SettingsView owns is the trail data. The home href is the
    // router-relative '/' -- RouterLink adds the '#' for the hash router.
    // The trail is deliberately fixed at two entries: the active tab and
    // section are already stated by the two tab tracks and the card heading
    // (user decision 2026-09-16), so routing did not add breadcrumb levels.
    expect(titleBarProps.links).toEqual([
      { name: 'breadcrumbs.home', href: '/' },
      { name: 'settings.title' },
    ]);
  });

  it.each([
    ['llm', 'llm'],
    ['embedding', 'embedding'],
  ] as const)('resumes the source platform after a successful %s save', async (section, capability) => {
    await act(async () => {
      renderAt(`/settings/ai/${section}?resume=github`);
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
      renderAt('/settings/ai/llm?resume=github');
    });

    await expect(cardProps.llm?.saveLlm({})).rejects.toThrow('save failed');
    expect(resumeCollectionProcessing).not.toHaveBeenCalled();
  });

  it('ignores an invalid resume platform after a successful save', async () => {
    await act(async () => {
      renderAt('/settings/ai/llm?resume=unknown');
    });

    await cardProps.llm?.saveLlm({});

    expect(settingsState.saveLlm).toHaveBeenCalledOnce();
    expect(resumeCollectionProcessing).not.toHaveBeenCalled();
  });
});
