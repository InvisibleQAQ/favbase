// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import { Label } from './label';
import { labelClasses } from './classes';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('Label', () => {
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

  const renderLabel = (node: ReactElement) => {
    act(() => {
      root.render(themed(node));
    });
    const el = container.querySelector(`.${labelClasses.root}`);
    if (!el) throw new Error('Label root not found');
    return el as HTMLElement;
  };

  it('carries the prefixed root class and renders children verbatim', () => {
    // Minimal upper-cases the first letter; we must not, because the string
    // already came out of t() with the casing its locale wants.
    const el = renderLabel(<Label>pending</Label>);

    expect(el.className).toContain('favbase__label__root');
    expect(el.textContent).toBe('pending');
  });

  it('wraps start and end icons in their own icon slot, keeping text order', () => {
    const el = renderLabel(
      <Label startIcon={<span data-testid="start" />} endIcon={<span data-testid="end" />}>
        done
      </Label>,
    );

    const icons = el.querySelectorAll(`.${labelClasses.icon}`);
    expect(icons).toHaveLength(2);
    expect(icons[0].querySelector('[data-testid="start"]')).not.toBeNull();
    expect(icons[1].querySelector('[data-testid="end"]')).not.toBeNull();
    expect(el.textContent).toBe('done');
  });

  it('resolves each of the four variants to its own style branch', () => {
    // The exact colors are asserted against WCAG in theme-contract.test.ts;
    // here we only prove the `variants` matchers actually fire, which shows up
    // as a distinct emotion class per variant. happy-dom cannot resolve the
    // layered CSS variables these mixins emit, so reading color values back
    // would test the DOM shim rather than the component.
    const emotionClass = (el: HTMLElement) =>
      Array.from(el.classList)
        .filter((name) => name.startsWith('css-'))
        .join(' ');

    const soft = emotionClass(renderLabel(<Label color="success">ok</Label>));
    const filled = emotionClass(
      renderLabel(
        <Label variant="filled" color="success">
          ok
        </Label>,
      ),
    );
    const outlinedEl = renderLabel(
      <Label variant="outlined" color="success">
        ok
      </Label>,
    );
    const outlined = emotionClass(outlinedEl);
    // Read while it is still mounted — the next render replaces this node.
    const outlinedBorderWidth = getComputedStyle(outlinedEl).borderWidth;
    const inverted = emotionClass(
      renderLabel(
        <Label variant="inverted" color="success">
          ok
        </Label>,
      ),
    );

    const classes = [soft, filled, outlined, inverted];
    classes.forEach((name) => expect(name).not.toBe(''));
    expect(new Set(classes).size).toBe(4);

    // outlined is the one variant whose box treatment is a plain literal, so
    // it is also readable through the DOM.
    expect(outlinedBorderWidth).toBe('2px');
  });

  it('keeps the same color on one variant stable, and separates two colors', () => {
    const emotionClass = (el: HTMLElement) =>
      Array.from(el.classList)
        .filter((name) => name.startsWith('css-'))
        .join(' ');

    const successA = emotionClass(renderLabel(<Label color="success">ok</Label>));
    const successB = emotionClass(renderLabel(<Label color="success">ok</Label>));
    const error = emotionClass(renderLabel(<Label color="error">no</Label>));

    expect(successA).toBe(successB);
    expect(error).not.toBe(successA);
  });

  it('mutes and blocks pointer events when disabled', () => {
    const el = renderLabel(<Label disabled>archived</Label>);
    const style = getComputedStyle(el);

    expect(style.opacity).toBe('0.48');
    expect(style.pointerEvents).toBe('none');
  });
});
