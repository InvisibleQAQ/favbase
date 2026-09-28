// @vitest-environment happy-dom

import type { ComponentProps } from 'react';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' }));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: i18n.locale }),
}));

import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';
import { Headline } from './section-shell';

type HeadlineProps = ComponentProps<typeof Headline>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function renderHeadline(props: HeadlineProps, locale: string) {
  i18n.locale = locale;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ThemeProvider>
        <Headline {...props} />
      </ThemeProvider>,
    );
  });

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  const heading = container.querySelector('h2');
  if (!heading) throw new Error('Headline did not render an h2');
  return heading;
}

// Neither translated half carries the separator (welcome.*.heading /
// headingTail), so the join is the whole difference between "Don't see your
// platform?" and "Don't see yourplatform?". Both inks that take a tail share
// the one join, and each is pinned here.
describe('Headline white ink with a tail', () => {
  const props = { ink: 'white', tail: 'tail', children: 'head' } as const;

  it('joins head and tail with a space in latin locales', () => {
    const heading = renderHeadline(props, 'en');

    expect(heading.textContent).toBe('head tail');
    expect(heading.querySelector('span')?.textContent).toBe('tail');
  });

  it('joins them with nothing in CJK', () => {
    const heading = renderHeadline(props, 'zh-CN');

    expect(heading.textContent).toBe('headtail');
  });
});

describe('Headline default (neutral) ink with a tail', () => {
  // No `ink`: the default is what every section title below the hero uses.
  const props = { tail: 'tail', children: 'head' };

  it('joins head and tail with a space in latin locales', () => {
    const heading = renderHeadline(props, 'en');

    expect(heading.textContent).toBe('head tail');
    expect(heading.querySelector('span')?.textContent).toBe('tail');
  });

  it('joins them with nothing in CJK', () => {
    const heading = renderHeadline(props, 'zh-CN');

    expect(heading.textContent).toBe('headtail');
  });
});

describe('Headline default ink', () => {
  // Relative, not a style snapshot: the same sx yields the same emotion class,
  // so the default must render exactly what `ink="neutral"` renders, and not
  // what the hero's `ink="brand"` renders (the default until docs/31 Step 3).
  // The inequality also keeps the equality from passing on two empty classes.
  it('paints what neutral paints, not the brand gradient', () => {
    const byDefault = renderHeadline({ children: 'head' }, 'en').className;

    expect(renderHeadline({ ink: 'neutral', children: 'head' }, 'en').className).toBe(byDefault);
    expect(renderHeadline({ ink: 'brand', children: 'head' }, 'en').className).not.toBe(byDefault);
  });
});

describe('Headline brand ink', () => {
  it('refuses a tail at compile time', () => {
    // The brand gradient runs across the whole line; a fade over it has no
    // defined colour, so the union forbids the pair. `pnpm compile` checks
    // test files, so this directive fails the build if the union loosens.
    // @ts-expect-error -- `tail` is `never` on the brand ink
    const props: HeadlineProps = { ink: 'brand', tail: 'tail', children: 'head' };

    expect(props.ink).toBe('brand');
  });
});
