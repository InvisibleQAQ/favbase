import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import type { IconifyName } from '../../components/iconify';

/**
 * The settings two-level navigation, enumerated once.
 *
 * Every tab and every section inside it is a route: `/settings/<tab>/<section>`
 * (docs/25 Step 7 gave Settings its two tracks; the routes came later). This
 * table is the single source of truth for all four consumers — the top `Tabs`,
 * the per-tab `SectionRail`, the router's validity check, and each tab's
 * default section (always its first entry). URL segments are the ids
 * themselves, so there is no segment mapping layer to keep in sync.
 *
 * What is deliberately *not* here: how a section renders. Cards take unrelated
 * props (`saveLlm` carries a resume side effect, `AgentBridgeCard` takes none),
 * so folding a `render` closure in would turn a plain data table into a context
 * pipeline. `settings-view.tsx` keeps a flat switch over `SettingsLeaf`
 * instead, and `tsc` names the missing case when a section is added here.
 */
export interface SettingsSectionDef {
  id: string;
  label: LocaleKeys;
  icon: IconifyName;
}

export interface SettingsTabDef {
  tab: string;
  label: LocaleKeys;
  icon: IconifyName;
  /** Non-empty: the first entry is the tab's default section. */
  sections: readonly SettingsSectionDef[];
}

export const SETTINGS_NAV = [
  {
    tab: 'ai',
    label: 'settings.tabAi',
    icon: 'solar:magic-stick-3-bold-duotone',
    sections: [
      { id: 'llm', label: 'settings.aiNav.llm', icon: 'solar:chat-round-dots-bold' },
      { id: 'asr', label: 'settings.aiNav.asr', icon: 'solar:subtitles-bold-duotone' },
      { id: 'embedding', label: 'settings.aiNav.embedding', icon: 'eva:search-fill' },
    ],
  },
  {
    tab: 'connections',
    label: 'settings.tabConnections',
    icon: 'solar:shield-keyhole-bold-duotone',
    sections: [
      { id: 'github', label: 'settings.github.title', icon: 'mdi:github' },
      { id: 'youtube', label: 'settings.youtube.title', icon: 'mdi:youtube' },
      { id: 'agent-bridge', label: 'settings.agentBridge.title', icon: 'solar:code-bold-duotone' },
    ],
  },
  {
    tab: 'general',
    label: 'settings.tabGeneral',
    icon: 'solar:global-bold-duotone',
    sections: [
      { id: 'language', label: 'settings.language', icon: 'solar:global-bold-duotone' },
    ],
  },
  {
    tab: 'storage',
    label: 'settings.tabStorage',
    icon: 'solar:database-bold-duotone',
    sections: [
      { id: 'export', label: 'export.title', icon: 'solar:database-bold-duotone' },
      { id: 'webdav', label: 'settings.sync.title', icon: 'solar:share-bold' },
    ],
  },
] as const satisfies readonly SettingsTabDef[];

type NavEntry = (typeof SETTINGS_NAV)[number];

export type SettingsTabId = NavEntry['tab'];

// Naked type parameter on purpose: the conditional has to distribute over the
// four-member union, otherwise the pairs cross-multiply into 36 leaves.
type LeafOf<T> = T extends {
  tab: infer Tab extends string;
  sections: readonly { id: infer Section extends string }[];
}
  ? `${Tab}/${Section}`
  : never;

/** `'ai/llm' | 'ai/asr' | ... | 'storage/webdav'` — the render switch's key. */
export type SettingsLeaf = LeafOf<NavEntry>;

export interface ResolvedSettingsRoute {
  tab: SettingsTabId;
  section: string;
  leaf: SettingsLeaf;
}

function findTab(tab: string | undefined): NavEntry | undefined {
  return SETTINGS_NAV.find((entry) => entry.tab === tab);
}

/** The canonical landing route for `/settings` and for anything unparseable. */
export const SETTINGS_DEFAULT_PATH = `/settings/${SETTINGS_NAV[0].tab}/${SETTINGS_NAV[0].sections[0].id}`;

/**
 * `/settings/<tab>/<its first section>` — where a bare tab segment lands, and
 * where the top tabs navigate. `null` for an unknown segment so the caller's
 * fallback chain stays honest instead of silently collapsing to the default.
 */
export function settingsTabPath(tab: string | undefined): string | null {
  const entry = findTab(tab);
  if (!entry) return null;
  return `/settings/${entry.tab}/${entry.sections[0].id}`;
}

/**
 * The route of one enumerated leaf, for anything linking *into* Settings.
 *
 * The point is the argument type, not the concatenation: a caller writes
 * `settingsPath('connections/github')` and `tsc` rejects it the day that
 * section is renamed or dropped from the table, where a bare string literal
 * would keep compiling and quietly land on the default leaf instead.
 */
export function settingsPath(leaf: SettingsLeaf): string {
  return `/settings/${leaf}`;
}

/**
 * URL segments -> the leaf to render, or `null` when the pair is incomplete or
 * unknown. A `null` is the caller's cue to redirect; nothing renders a 404,
 * matching the silent fallback the old `?section=` query already had.
 */
export function resolveSettingsRoute(
  tab: string | undefined,
  section: string | undefined,
): ResolvedSettingsRoute | null {
  const entry = findTab(tab);
  if (!entry) return null;
  const match = entry.sections.find((item) => item.id === section);
  if (!match) return null;
  return {
    tab: entry.tab,
    section: match.id,
    leaf: `${entry.tab}/${match.id}` as SettingsLeaf,
  };
}

/**
 * Legacy deep link support: `/settings?section=llm|asr|embedding` predates the
 * nested routes and is still reachable from a user's bookmark. Only the three
 * AI capabilities were ever emitted (`collection-configuration-notice.tsx`),
 * so the query maps onto the `ai` tab and nothing else.
 */
export function legacySectionPath(section: string | null): string | null {
  const ai = SETTINGS_NAV[0];
  const match = ai.sections.find((item) => item.id === section);
  return match ? `/settings/${ai.tab}/${match.id}` : null;
}
