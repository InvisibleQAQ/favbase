// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/entrypoints/app/layouts/dashboard/header-actions', () => ({
  HeaderActions: () => null,
}));

import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';
import { TopBar } from './top-bar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('welcome TopBar', () => {
  it('does not expose a Skip Intro action', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <ThemeProvider>
          <TopBar />
        </ThemeProvider>,
      );
    });

    expect(container.textContent).not.toContain('welcome.skip');

    act(() => root.unmount());
    container.remove();
  });
});
