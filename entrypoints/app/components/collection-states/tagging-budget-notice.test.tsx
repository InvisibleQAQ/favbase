// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same `t` mock as `collection-states.test.tsx`: keys come back verbatim with
// each param appended as `|name=value`.
vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    locale: 'en',
    preference: 'en',
    setLocale: vi.fn(),
    t: (key: string, params?: Record<string, string | number>) => {
      let value = key;
      for (const [name, param] of Object.entries(params ?? {})) {
        value = `${value}|${name}=${String(param)}`;
      }
      return value;
    },
  }),
}));

// The real index reads `chrome.storage` on load.
vi.mock('@/lib/i18n', () => ({
  formatCompactNumber: (value: number) => `compact(${value})`,
}));

vi.mock('../iconify', () => ({
  Iconify: ({ icon, width }: { icon: string; width?: number }) => (
    <span data-icon={icon} data-width={width} />
  ),
}));

import { TaggingBudgetNotice } from './index';

describe('TaggingBudgetNotice', () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (hold: { spent: number; pending: number } | null) =>
    act(() => {
      root.render(
        <ThemeProvider>
          <MemoryRouter>
            <TaggingBudgetNotice hold={hold} />
          </MemoryRouter>
        </ThemeProvider>,
      );
    });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders nothing without a hold', () => {
    render(null);

    expect(container.innerHTML).toBe('');
  });

  it("states today's spend against the user's own limit, the waiting items and one settings link", () => {
    render({ spent: 10_250_000, pending: 37 });

    const status = container.querySelectorAll('[role="status"]');
    expect(status).toHaveLength(1);
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(status[0]?.textContent).toContain('taggingBudget.reached|spent=compact(10250000)');
    expect(status[0]?.textContent).toContain('taggingBudget.pending|count=37');

    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    // No `?resume=`: every LLM save already resumes Tags on every platform.
    expect(links[0]?.getAttribute('href')).toBe('/settings/ai/llm');
    expect(links[0]?.textContent).toBe('taggingBudget.adjust');
    expect(container.querySelector('[data-icon]')?.getAttribute('data-icon')).toBe(
      'solar:settings-bold-duotone',
    );
  });

  it('is not the Configuration Blocker banner', () => {
    render({ spent: 1, pending: 1 });

    expect(container.querySelector('.MuiAlert-root')).toBeNull();
    expect(container.textContent).not.toContain('configurationBlocker');
  });
});
