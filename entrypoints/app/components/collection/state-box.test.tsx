// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { StateBox } from './state-box';
import { ErrorState } from './error-state';
import { NoMatchesState } from './no-matches-state';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('page state boxes', () => {
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

  it('StateBox keeps its title a paragraph and orders icon → title → description → action', () => {
    act(() => {
      root.render(
        themed(
          <StateBox
            icon={<span data-testid="icon" />}
            title="Nothing here yet"
            description="Fetch your favorites to start."
            action={<button type="button">Fetch now</button>}
          />,
        ),
      );
    });

    const box = container.querySelector('[data-state-box]');
    expect(box).not.toBeNull();
    expect(container.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    const order = Array.from(box?.children ?? []).map((el) =>
      el.matches('[data-testid="icon"]') ? 'icon' : el.tagName === 'BUTTON' ? 'action' : el.textContent,
    );
    expect(order).toEqual(['icon', 'Nothing here yet', 'Fetch your favorites to start.', 'action']);
  });

  it('NoMatchesState reuses the same box with the message as its description', () => {
    act(() => {
      root.render(themed(<NoMatchesState message="No videos match" />));
    });

    const box = container.querySelector('[data-state-box]');
    expect(box?.textContent).toBe('No videos match');
    expect(box?.querySelector('.MuiTypography-body2')).not.toBeNull();
  });

  it('ErrorState says what failed and offers one retry action', () => {
    const onRetry = vi.fn();
    act(() => {
      root.render(
        themed(
          <ErrorState title="Load failed" message="boom" retryLabel="Retry" onRetry={onRetry} />,
        ),
      );
    });

    expect(container.textContent).toContain('Load failed');
    expect(container.textContent).toContain('boom');
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('Retry');
    act(() => {
      buttons[0].click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
