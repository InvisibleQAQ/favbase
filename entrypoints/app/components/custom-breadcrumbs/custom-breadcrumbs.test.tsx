// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { CustomBreadcrumbs } from './custom-breadcrumbs';

const themed = (node: ReactElement) => (
  <ThemeProvider>
    <MemoryRouter>{node}</MemoryRouter>
  </ThemeProvider>
);

describe('CustomBreadcrumbs', () => {
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

  const render = (node: ReactElement) => {
    act(() => {
      root.render(themed(node));
    });
  };

  it('renders the heading as the page single h1', () => {
    render(<CustomBreadcrumbs heading="GitHub Stars" />);

    const headings = container.querySelectorAll('h1');
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe('GitHub Stars');
    expect(container.querySelectorAll('h2, h3, h4, h5, h6')).toHaveLength(0);
  });

  it('puts the trail in a nav and marks the trailing crumb as the current page', () => {
    render(
      <CustomBreadcrumbs
        heading="GitHub Stars"
        links={[
          { name: 'Collections', href: '/collections' },
          { name: 'GitHub Stars' },
        ]}
      />,
    );

    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();

    const crumbs = nav?.querySelectorAll('li') ?? [];
    // Two crumbs plus the separator MUI inserts between them.
    expect(crumbs.length).toBeGreaterThanOrEqual(2);

    const current = nav?.querySelector('[aria-current="page"]');
    expect(current?.textContent).toBe('GitHub Stars');
    // The current page is not a link.
    expect(current?.closest('a')).toBeNull();

    const ancestor = nav?.querySelector('a');
    expect(ancestor?.textContent).toBe('Collections');
    expect(ancestor?.getAttribute('href')).toBe('/collections');
  });

  it('makes the trailing crumb live when activeLast is set', () => {
    render(
      <CustomBreadcrumbs
        links={[{ name: 'Collections', href: '/collections' }, { name: 'X', href: '/collections/x' }]}
        activeLast
      />,
    );

    expect(container.querySelector('[aria-current="page"]')).toBeNull();
    expect(container.querySelectorAll('nav a')).toHaveLength(2);
  });

  it('turns the heading into a back link when backHref is given', () => {
    render(<CustomBreadcrumbs heading="Bilibili" backHref="/collections" />);

    const link = container.querySelector('h1 a');
    expect(link?.getAttribute('href')).toBe('/collections');
    expect(link?.textContent).toBe('Bilibili');
    expect(link?.querySelector('svg')).not.toBeNull();
  });

  it('renders the action beside the heading, outside the nav', () => {
    render(
      <CustomBreadcrumbs heading="X" action={<button type="button">Fetch now</button>} />,
    );

    const button = container.querySelector('button');
    expect(button?.textContent).toBe('Fetch now');
    expect(button?.closest('nav')).toBeNull();
  });
});
