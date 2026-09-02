// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { LoadingScreen } from './loading-screen';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('LoadingScreen', () => {
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

  it('announces pending work through an indeterminate progressbar', () => {
    render(<LoadingScreen />);

    const bar = container.querySelector('[role="progressbar"]');
    expect(bar).not.toBeNull();
    expect(bar?.className).toMatch(/MuiLinearProgress-indeterminate/);
    // Indeterminate means no value to announce.
    expect(bar?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('lets a caller replace the progress slot', () => {
    render(<LoadingScreen slots={{ progress: <span data-testid="custom" /> }} />);

    expect(container.querySelector('[data-testid="custom"]')).not.toBeNull();
    expect(container.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('renders into a portal outside its parent when asked', () => {
    render(<LoadingScreen portal />);

    expect(container.querySelector('[role="progressbar"]')).toBeNull();
    expect(document.body.querySelector('[role="progressbar"]')).not.toBeNull();
  });
});
