// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The real i18n store runs (that is what drives selection and the trigger flag);
// only its persistence is stubbed so the write can be asserted.
const localeState = vi.hoisted(() => ({
  writes: [] as string[],
  watchers: new Set<(value: string) => void>(),
}));

vi.mock('@/lib/storage', () => ({
  localeStorage: {
    getValue: () => Promise.resolve('auto' as const),
    setValue: (value: string) => {
      localeState.writes.push(value);
      return Promise.resolve();
    },
    watch: (callback: (value: string) => void) => {
      localeState.watchers.add(callback);
      return () => localeState.watchers.delete(callback);
    },
  },
}));

import { setLocale } from '@/lib/i18n';

import { ThemeProvider } from '../../theme/theme-provider';
import { LanguagePopover } from './language-popover';

function menuItems(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('.MuiMenuItem-root'));
}

describe('LanguagePopover', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    localeState.writes.length = 0;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      // A concrete preference keeps the assertions independent of navigator.language.
      setLocale('zh-CN');
      root.render(
        <ThemeProvider>
          <LanguagePopover />
        </ThemeProvider>,
      );
    });
    localeState.writes.length = 0;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('offers both languages and marks the resolved one as selected', async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
      await vi.advanceTimersByTimeAsync(1000);
    });

    const items = menuItems();
    expect(items).toHaveLength(2);
    expect(items[0].className).toContain('Mui-selected');
    expect(items[1].className).not.toContain('Mui-selected');
  });

  it('persists the picked language and re-renders the trigger', async () => {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button')?.click();
      await vi.advanceTimersByTimeAsync(1000);
    });

    await act(async () => {
      menuItems()[1].click();
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(localeState.writes).toEqual(['en']);
    // The trigger shows the newly resolved locale's flag, not the preference.
    expect(container.querySelector('.iconify--flagpack')).not.toBeNull();
    expect(document.body.querySelector('.MuiMenuItem-root')).toBeNull();
  });
});
