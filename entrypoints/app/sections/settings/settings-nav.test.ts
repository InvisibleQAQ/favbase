import { describe, expect, it } from 'vitest';

import {
  SETTINGS_DEFAULT_PATH,
  SETTINGS_NAV,
  legacySectionPath,
  resolveSettingsRoute,
  settingsTabPath,
} from './settings-nav';

describe('settings navigation registry', () => {
  it('gives every tab at least one section, since the first one is its default', () => {
    for (const entry of SETTINGS_NAV) {
      expect(entry.sections.length).toBeGreaterThan(0);
    }
  });

  it('keeps tab and section ids URL-safe and unique within their tab', () => {
    // The ids are the URL segments themselves — there is no mapping layer, so
    // anything needing escaping would silently produce a route nobody can type.
    const segment = /^[a-z0-9]+(-[a-z0-9]+)*$/;
    const tabs = SETTINGS_NAV.map((entry) => entry.tab);
    expect(new Set(tabs).size).toBe(tabs.length);

    for (const entry of SETTINGS_NAV) {
      expect(entry.tab).toMatch(segment);
      const ids = entry.sections.map((section) => section.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(segment);
    }
  });

  it('resolves every registered leaf', () => {
    for (const entry of SETTINGS_NAV) {
      for (const section of entry.sections) {
        expect(resolveSettingsRoute(entry.tab, section.id)).toEqual({
          tab: entry.tab,
          section: section.id,
          leaf: `${entry.tab}/${section.id}`,
        });
      }
    }
  });

  it.each([
    [undefined, undefined],
    ['ai', undefined],
    ['ai', 'nope'],
    ['nope', 'llm'],
    ['ai', 'github'],
  ])('rejects the incomplete or crossed pair (%s, %s)', (tab, section) => {
    expect(resolveSettingsRoute(tab, section)).toBeNull();
  });

  it('sends a bare tab to its first section and an unknown tab to null', () => {
    expect(settingsTabPath('connections')).toBe('/settings/connections/github');
    expect(settingsTabPath('storage')).toBe('/settings/storage/export');
    expect(settingsTabPath('nope')).toBeNull();
    expect(settingsTabPath(undefined)).toBeNull();
  });

  it('points the default path at the first leaf of the first tab', () => {
    expect(SETTINGS_DEFAULT_PATH).toBe('/settings/ai/llm');
    expect(resolveSettingsRoute('ai', 'llm')).not.toBeNull();
  });

  it.each(['llm', 'asr', 'embedding'])(
    'maps the legacy ?section=%s query onto the AI tab',
    (section) => {
      expect(legacySectionPath(section)).toBe(`/settings/ai/${section}`);
    },
  );

  it.each([null, 'unknown', 'github', 'webdav'])(
    'refuses to upgrade the legacy query value %s',
    (section) => {
      // Only the three AI capabilities were ever emitted into that query
      // (`collection-configuration-notice.tsx`); a section id from another tab
      // arriving there is a typo, not a deep link.
      expect(legacySectionPath(section)).toBeNull();
    },
  );
});
