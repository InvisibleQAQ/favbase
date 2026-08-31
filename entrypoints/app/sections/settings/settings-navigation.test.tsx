// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material/useMediaQuery', () => ({ default: () => true }));

import { ThemeProvider } from '../../theme/theme-provider';
import { SectionRail } from './section-rail';
import { SettingsTabs } from './settings-tabs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
            tabs={[
              { value: 'ai', label: 'AI configuration', icon: 'solar:magic-stick-3-bold-duotone' },
              { value: 'connections', label: 'Account connections', icon: 'solar:shield-keyhole-bold-duotone' },
              { value: 'general', label: 'General settings', icon: 'solar:global-bold-duotone' },
              { value: 'storage', label: 'Storage management', icon: 'solar:database-bold-duotone' },
            ]}
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
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(7);
  });
});
