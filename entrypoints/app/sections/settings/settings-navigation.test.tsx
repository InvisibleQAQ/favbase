// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material/useMediaQuery', () => ({ default: () => true }));

import { ThemeProvider } from '../../theme/theme-provider';
import { SectionRail } from './section-rail';
import { SettingsTabs, type SettingsTabItem } from './settings-tabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TOP_TABS = [
  { value: 'ai', label: 'AI configuration', icon: 'solar:magic-stick-3-bold-duotone' },
  { value: 'connections', label: 'Account connections', icon: 'solar:shield-keyhole-bold-duotone' },
  { value: 'general', label: 'General settings', icon: 'solar:global-bold-duotone' },
  { value: 'storage', label: 'Storage management', icon: 'solar:database-bold-duotone' },
] as const satisfies readonly SettingsTabItem[];

describe('Settings responsive navigation', () => {
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

  it('uses scrollable tab tracks on compact viewports so long labels keep their width', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SettingsTabs
            value="connections"
            onChange={() => {}}
            ariaLabel="Settings"
            tabs={[...TOP_TABS]}
          />
          <SectionRail
            value="agent-bridge"
            onChange={() => {}}
            ariaLabel="Connections"
            items={[
              { value: 'github', label: 'GitHub', icon: 'mdi:github' },
              { value: 'youtube', label: 'YouTube', icon: 'mdi:youtube' },
              { value: 'agent-bridge', label: 'Agent Bridge', icon: 'solar:code-bold-duotone' },
            ]}
          />
        </ThemeProvider>,
      );
    });

    const tabs = [...container.querySelectorAll('.MuiTabs-root')];
    expect(tabs).toHaveLength(2);
    expect(tabs.every((tab) => tab.querySelector('.MuiTabs-scroller.MuiTabs-scrollableX'))).toBe(true);
    expect(container.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Settings');

    // Width is kept by `nowrap`, not by a fixed minWidth: docs/25 Step 7 dropped
    // the segmented skin's 112/116px floors, so the track scrolls rather than
    // letting a localized label wrap onto a second line.
    const tabButtons = [...container.querySelectorAll('[role="tab"]')];
    expect(tabButtons).toHaveLength(7);
    expect(tabButtons.every((tab) => getComputedStyle(tab).whiteSpace === 'nowrap')).toBe(true);
  });

  it('centers the top tab track within the page width', () => {
    // Rendered alone on purpose: this file's other case mounts SettingsTabs and
    // SectionRail in one tree, and the rail must never be able to satisfy this
    // assertion — centering is the top track's local override only, the rail
    // stays untouched (ui-design-system.md section 11).
    act(() => {
      root.render(
        <ThemeProvider>
          <SettingsTabs
            value="connections"
            onChange={() => {}}
            ariaLabel="Settings"
            tabs={[...TOP_TABS]}
          />
        </ThemeProvider>,
      );
    });

    const tabs = [...container.querySelectorAll('.MuiTabs-root')];
    expect(tabs).toHaveLength(1);

    // User decision 2026-09-08: the row is centered even though it then leaves
    // the left baseline of the `Settings` h1 and its breadcrumbs.
    const style = getComputedStyle(tabs[0]);
    expect(style.width).toBe('fit-content');
    expect(style.marginLeft).toBe('auto');
    expect(style.marginRight).toBe('auto');

    // The clamp is the narrow-viewport guarantee (`1` resolves to `100%`): it
    // keeps the track inside its container whatever `fit-content` does, so it
    // must not be deleted as redundant.
    expect(style.maxWidth).toBe('100%');

    // `fit-content` must not have come from swapping the theme's `scrollable`
    // default for `standard`/`centered`: a full row still has to scroll.
    expect(tabs[0].querySelector('.MuiTabs-scroller.MuiTabs-scrollableX')).not.toBeNull();
  });
});
