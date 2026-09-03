// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../iconify', () => ({
  Iconify: ({ icon, className }: { icon: string; className?: string }) => (
    <span data-icon={icon} className={className} aria-hidden="true" />
  ),
}));

import { toast } from 'sonner';

import { Snackbar } from './snackbar';
import { snackbarClasses } from './classes';
import { ThemeProvider } from '../../theme/theme-provider';

/**
 * sonner defers every store update by a macrotask ("Prevent batching, temp
 * solution" in its `useSonner`), so a microtask flush is not enough to see a
 * toast land.
 */
async function emit(dispatch: () => void) {
  await act(async () => {
    dispatch();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function region(): HTMLElement {
  const found = document.querySelector('section[aria-label]');
  if (!(found instanceof HTMLElement)) throw new Error('Toast region not found');
  return found;
}

describe('Snackbar', () => {
  let container: HTMLDivElement;
  let root: Root;

  async function render() {
    await act(async () => root.render(
      <ThemeProvider>
        <Snackbar />
      </ThemeProvider>,
    ));
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await emit(() => toast.dismiss());
    act(() => root.unmount());
    container.remove();
  });

  it('announces the region in the UI locale, not sonner English default', async () => {
    await render();

    // sonner appends the hotkey hint to whatever containerAriaLabel it is given.
    expect(region().getAttribute('aria-label')).toContain('snackbar.regionLabel');
  });

  it('names the per-toast close button in the UI locale', async () => {
    await render();

    await emit(() => toast.success('saved'));

    // `closeButton` is on for every toast, and sonner's own default name for it
    // is the English "Close toast" — an icon-only control must not carry it.
    const close = region().querySelector('[data-close-button]');
    expect(close?.getAttribute('aria-label')).toBe('snackbar.closeAria');
  });

  it('portals the region out of its mount point so a clipped route cannot hide it', async () => {
    await render();

    expect(container.contains(region())).toBe(false);
  });

  it.each([
    ['success', 'solar:check-circle-bold'],
    ['error', 'solar:danger-bold'],
    ['warning', 'solar:danger-triangle-bold'],
    ['info', 'solar:info-circle-bold'],
  ] as const)('renders a %s toast with its registered offline icon', async (kind, icon) => {
    await render();

    await emit(() => toast[kind](`hello ${kind}`));

    const toastEl = region().querySelector(`.${snackbarClasses.toast}`);
    expect(toastEl).not.toBeNull();
    expect(toastEl?.textContent).toContain(`hello ${kind}`);
    expect(toastEl?.classList.contains(snackbarClasses[kind])).toBe(true);
    expect(toastEl?.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
  });

  it('keeps the skin hooks on the title and icon slots', async () => {
    await render();

    await emit(() => toast.success('saved'));

    expect(region().querySelector(`.${snackbarClasses.title}`)?.textContent).toBe('saved');
    expect(region().querySelector(`.${snackbarClasses.icon}`)).not.toBeNull();
  });
});
