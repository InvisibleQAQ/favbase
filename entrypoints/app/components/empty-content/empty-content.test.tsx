// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { EmptyContent } from './empty-content';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('EmptyContent', () => {
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
    return container.firstElementChild as HTMLElement;
  };

  it('renders nothing by default — no built-in illustration and no default title', () => {
    // Minimal ships a bundled SVG and the literal "No data"; we have neither
    // that asset nor a generic i18n key, and NoMatchesState relies on the box
    // holding exactly the caller's copy.
    const el = render(<EmptyContent />);

    expect(el.textContent).toBe('');
    expect(el.querySelector('img')).toBeNull();
  });

  it('keeps the title a paragraph so the page keeps its single h1', () => {
    const el = render(<EmptyContent title="Nothing here yet" />);

    const title = el.querySelector('p');
    expect(title?.textContent).toBe('Nothing here yet');
    expect(title?.className).toMatch(/MuiTypography-subtitle1/);
    expect(el.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('draws the tinted dashed shell only when filled', () => {
    const plain = render(<EmptyContent title="a" />);
    const plainClass = Array.from(plain.classList).join(' ');
    const plainBorderStyle = getComputedStyle(plain).borderStyle;

    const filled = render(<EmptyContent filled title="a" />);
    const filledBorderStyle = getComputedStyle(filled).borderStyle;

    expect(filledBorderStyle).toBe('dashed');
    expect(plainBorderStyle).not.toBe('dashed');
    expect(Array.from(filled.classList).join(' ')).not.toBe(plainClass);
  });

  it('orders illustration → title → description → action as direct children', () => {
    const el = render(
      <EmptyContent
        icon={<span data-testid="icon" />}
        title="Nothing here yet"
        description="Fetch your favorites to start."
        action={<button type="button">Fetch now</button>}
      />,
    );

    const order = Array.from(el.children).map((child) =>
      child.matches('[data-testid="icon"]')
        ? 'icon'
        : child.tagName === 'BUTTON'
          ? 'action'
          : child.textContent,
    );
    expect(order).toEqual([
      'icon',
      'Nothing here yet',
      'Fetch your favorites to start.',
      'action',
    ]);
  });

  it('prefers an icon over imgUrl, and falls back to the image when no icon is given', () => {
    const withIcon = render(<EmptyContent icon={<span data-testid="icon" />} imgUrl="/a.svg" />);
    expect(withIcon.querySelector('[data-testid="icon"]')).not.toBeNull();
    expect(withIcon.querySelector('img')).toBeNull();

    const withImg = render(<EmptyContent imgUrl="/a.svg" />);
    expect(withImg.querySelector('img')?.getAttribute('src')).toBe('/a.svg');
  });
});
