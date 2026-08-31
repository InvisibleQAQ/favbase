// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { SettingsPanel } from './settings-panel';

describe('SettingsPanel', () => {
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

  it('owns one panel surface with an h2 section title and plain content', () => {
    act(() => {
      root.render(
        <ThemeProvider>
          <SettingsPanel title="Language" description="Choose the app language">
            <label>Preference</label>
          </SettingsPanel>
        </ThemeProvider>,
      );
    });

    const panel = container.querySelector('[data-slot="settings-panel"]');
    expect(panel?.querySelectorAll('h2')).toHaveLength(1);
    expect(panel?.querySelector('h2')?.textContent).toBe('Language');
    expect(panel?.querySelector('.MuiCard-root')).toBeNull();
    expect(panel?.textContent).toContain('Choose the app language');
    expect(panel?.textContent).toContain('Preference');
  });
});
