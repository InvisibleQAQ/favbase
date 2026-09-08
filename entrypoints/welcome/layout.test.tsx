// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('./sections/top-bar-actions', () => ({
  TopBarActions: () => null,
}));

vi.mock('wxt/browser', () => ({
  browser: { runtime: { getManifest: () => ({ version: '0.0.0' }) } },
}));

import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';
import { WelcomeLayout } from './layout';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ThemeProvider>
        <WelcomeLayout>
          <div />
        </WelcomeLayout>
      </ThemeProvider>,
    );
  });

  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('WelcomeLayout', () => {
  it('does not expose a Skip Intro action', () => {
    const { container, cleanup } = render();

    // The picker is the only exit; it accepts an empty selection, so a separate
    // skip control would be a second way to do the same thing.
    expect(container.textContent).not.toContain('welcome.skip');

    cleanup();
  });

  it('carries the version and licence in the footer', () => {
    const { container, cleanup } = render();

    // These two facts appear nowhere else in the product — if the footer stops
    // printing them, they are gone entirely.
    expect(container.textContent).toContain('v0.0.0');
    expect(container.textContent).toContain('GPL-3.0');

    cleanup();
  });
});
