// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const i18n = vi.hoisted(() => ({ locale: 'en' }));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: i18n.locale }),
}));

import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';
import { Headline } from './section-shell';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

function renderWhiteHeadline(locale: string) {
  i18n.locale = locale;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ThemeProvider>
        <Headline ink="white" tail="tail">
          head
        </Headline>
      </ThemeProvider>,
    );
  });

  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };

  const heading = container.querySelector('h2');
  if (!heading) throw new Error('Headline did not render an h2');
  return heading;
}

describe('Headline white ink with a tail', () => {
  // Neither translated half carries the separator (welcome.request.heading /
  // headingTail), so the join is the whole difference between "Don't see
  // your platform?" and "Don't see yourplatform?".
  it('joins head and tail with a space in latin locales', () => {
    const heading = renderWhiteHeadline('en');

    expect(heading.textContent).toBe('head tail');
    expect(heading.querySelector('span')?.textContent).toBe('tail');
  });

  it('joins them with nothing in CJK', () => {
    const heading = renderWhiteHeadline('zh-CN');

    expect(heading.textContent).toBe('headtail');
  });
});
