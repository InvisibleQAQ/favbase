// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { SectionTitleBar } from './section-title-bar';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

// The breadcrumb branch renders router links, so it needs a router around it.
const routed = (node: ReactElement) => (
  <ThemeProvider>
    <MemoryRouter>{node}</MemoryRouter>
  </ThemeProvider>
);

describe('SectionTitleBar anatomy', () => {
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

  it('renders the route title as the single h1 with the caption stacked beneath it', () => {
    act(() => {
      root.render(themed(<SectionTitleBar title="GitHub Stars" caption="128 · synced" />));
    });

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('GitHub Stars');
    expect(headings[0].className).toMatch(/MuiTypography-h1/);

    const caption = container.querySelector('[data-slot="caption"]');
    expect(caption?.textContent).toBe('128 · synced');
    // Same column as the title, directly under it — not an inline trailer.
    expect(headings[0].nextElementSibling).toBe(caption);
    // No action unless the page has one.
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders one contained, normal-size action with the sync three-state', () => {
    const onSync = vi.fn();
    act(() => {
      root.render(
        themed(
          <SectionTitleBar
            title="X"
            onSync={onSync}
            syncLabel="Fetch now"
            syncingLabel="Fetching…"
          />,
        ),
      );
    });

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Fetch now');
    expect(button?.className).toMatch(/MuiButton-contained/);
    expect(button?.className).toMatch(/MuiButton-sizeMedium/);
    expect(button?.hasAttribute('disabled')).toBe(false);

    act(() => {
      button?.click();
    });
    expect(onSync).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(
        themed(
          <SectionTitleBar title="X" syncing onSync={onSync} syncLabel="Fetch now" syncingLabel="Fetching…" />,
        ),
      );
    });
    expect(container.querySelector('button')?.textContent).toBe('Fetching…');
    expect(container.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  });

  it('hard-disables with the countdown label, and explains a gate pause through a tooltip wrapper', () => {
    act(() => {
      root.render(
        themed(
          <SectionTitleBar
            title="X"
            onSync={() => {}}
            syncLabel="Fetch now"
            syncingLabel="Fetching…"
            syncDisabled
            syncDisabledLabel="Retry in 30s"
          />,
        ),
      );
    });
    let button = container.querySelector('button');
    expect(button?.textContent).toBe('Retry in 30s');
    expect(button?.hasAttribute('disabled')).toBe(true);

    act(() => {
      root.render(
        themed(
          <SectionTitleBar
            title="X"
            onSync={() => {}}
            syncLabel="Fetch now"
            syncingLabel="Fetching…"
            syncDisabled
            syncDisabledTooltip="Paused by the library gate"
          />,
        ),
      );
    });
    button = container.querySelector('button');
    expect(button?.textContent).toBe('Fetch now');
    expect(button?.hasAttribute('disabled')).toBe(true);
    // MUI Tooltip attaches its accessible name to the focusable span wrapper.
    expect(button?.parentElement?.getAttribute('aria-label')).toBe('Paused by the library gate');
  });

  it('renders ancestry as a nav whose last crumb is the current page, keeping the caption', () => {
    act(() => {
      root.render(
        routed(
          <SectionTitleBar
            title="GitHub Stars"
            caption="128 · synced"
            links={[{ name: 'Collections', href: '/collections' }, { name: 'GitHub Stars' }]}
            onSync={() => {}}
            syncLabel="Fetch now"
            syncingLabel="Fetching…"
          />,
        ),
      );
    });

    // Still one h1, still the same handles the pages assert on.
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('[data-section="title"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="caption"]')?.textContent).toBe('128 · synced');

    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('[aria-current="page"]')?.textContent).toBe('GitHub Stars');
    expect(nav?.querySelector('a')?.getAttribute('href')).toBe('/collections');

    // The action stays out of the trail.
    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Fetch now');
    expect(button?.closest('nav')).toBeNull();
  });
});
