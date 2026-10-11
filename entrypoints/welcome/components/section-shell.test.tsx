// @vitest-environment happy-dom

import type { ComponentProps } from 'react';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' }));
const motionPrefs = vi.hoisted(() => ({ reduce: false }));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: i18n.locale }),
}));

// Partial mock: `motion` itself stays real, so the brand tail animates (or
// does not) for real; only the preference `Headline` reads is pinned per case.
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('motion/react')>()),
  useReducedMotion: () => motionPrefs.reduce,
}));

import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';
import { Headline } from './section-shell';

type HeadlineProps = ComponentProps<typeof Headline>;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  motionPrefs.reduce = false;
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
// headingTail, welcome.hero.titleLine2 / titleBrand), so the join is the whole
// difference between "Don't see your platform?" and "Don't see
// yourplatform?". Every ink that takes a tail shares the one join, and each is
// pinned here.
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

describe('Headline brand ink with a tail', () => {
  // The hero's second line: "now answerable" / 「变成知识库」.
  const props = { ink: 'brand', tail: 'tail', children: 'head' } as const;

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
  // so the default must render exactly what `ink="neutral"` renders, head and
  // tail, and each half has its own control. The head's is the hero's first
  // line (`ink="muted"`, `text.secondary`). The tail's is `brand`, the default
  // until docs/31 Step 3: since docs/39 Step 3 a brand head is the same solid
  // `text.primary` as a neutral one, so only the tail still tells a default
  // flipped back to brand apart. The inequalities also keep the equalities
  // from passing on two empty classes.
  it('paints what neutral paints, not the muted grey', () => {
    const byDefault = renderHeadline({ children: 'head' }, 'en').className;

    expect(renderHeadline({ ink: 'neutral', children: 'head' }, 'en').className).toBe(byDefault);
    expect(renderHeadline({ ink: 'muted', children: 'head' }, 'en').className).not.toBe(byDefault);
  });

  // Motion writes `background-position` inline and leaves the class alone, so
  // the brand flow does not disturb the comparison.
  it('fades its tail as neutral does, not with the brand flow', () => {
    const tailClass = (props: HeadlineProps) =>
      renderHeadline(props, 'en').querySelector('span')!.className;
    const byDefault = tailClass({ tail: 't', children: 'h' });

    expect(tailClass({ ink: 'neutral', tail: 't', children: 'h' })).toBe(byDefault);
    expect(tailClass({ ink: 'brand', tail: 't', children: 'h' })).not.toBe(byDefault);
  });
});

describe('Headline ink and tail pairing', () => {
  // `pnpm compile` checks test files, so each directive below fails the build
  // if the union loosens.
  it('refuses a tail on the muted ink at compile time', () => {
    // The hero's first line has no second half.
    // @ts-expect-error -- `tail` is `never` on the muted ink
    const props: HeadlineProps = { ink: 'muted', tail: 'tail', children: 'head' };

    expect(props.ink).toBe('muted');
  });

  it('requires a tail on the brand ink at compile time', () => {
    // The tail is the brand word; without it brand paints what neutral does.
    // @ts-expect-error -- `tail` is required on the brand ink
    const props: HeadlineProps = { ink: 'brand', children: 'head' };

    expect(props.ink).toBe('brand');
  });
});

// `MotionConfig reducedMotion="user"` (main.tsx) looks as if it stilled every
// animation on the page, but it leaves `background-position` running
// (welcome/CLAUDE.md "动画"). The brand word's flow stops only because
// `Headline` gates it with its own `useReducedMotion()`, which is exactly the
// line that looks redundant. The allowed case is the control: without it, the
// reduced case would also pass wherever motion never animates at all.
describe('Headline brand tail flow', () => {
  async function brandTailAfterFrames(reduce: boolean) {
    motionPrefs.reduce = reduce;
    const heading = renderHeadline({ ink: 'brand', tail: 'tail', children: 'head' }, 'en');

    // Give motion's frame loop time to write a few frames.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    const tail = heading.querySelector('span');
    if (!tail) throw new Error('Headline did not render the brand tail');
    return tail;
  }

  it('walks the gradient when motion is allowed', async () => {
    const tail = await brandTailAfterFrames(false);

    // 0% -> 200% over 20 s, linear: ~1% after the wait above.
    expect(tail.style.backgroundPosition).toMatch(/^\d+(\.\d+)?% center$/);
  });

  it('never moves it under reduced motion', async () => {
    const tail = await brandTailAfterFrames(true);

    expect(tail.style.backgroundPosition).toBe('');
  });
});
