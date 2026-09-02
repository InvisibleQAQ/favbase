// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { Scrollbar } from './scrollbar';
import { scrollbarClasses } from './classes';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('Scrollbar', () => {
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

  it('mounts simplebar around its children and keeps them reachable', () => {
    render(
      <Scrollbar>
        <p data-testid="child">rows</p>
      </Scrollbar>,
    );

    const bar = container.querySelector('[data-simplebar]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toContain('favbase__scrollbar__root');
    expect(container.querySelector('[data-testid="child"]')?.textContent).toBe('rows');
  });

  it('keeps a real overflow element in the tree so native scrolling still works', () => {
    render(
      <Scrollbar>
        <p>rows</p>
      </Scrollbar>,
    );

    // simplebar hides the platform bar but scrolls a genuine element; losing
    // this wrapper would take keyboard and screen-reader scrolling with it.
    const scrollable = container.querySelector('.simplebar-content-wrapper');
    expect(scrollable).not.toBeNull();
    expect(container.querySelector('.simplebar-content')).not.toBeNull();
  });

  it('merges a caller class without dropping its own', () => {
    render(<Scrollbar className="page-list">rows</Scrollbar>);

    const bar = container.querySelector('[data-simplebar]');
    expect(bar?.classList.contains(scrollbarClasses.root)).toBe(true);
    expect(bar?.classList.contains('page-list')).toBe(true);
  });
});
