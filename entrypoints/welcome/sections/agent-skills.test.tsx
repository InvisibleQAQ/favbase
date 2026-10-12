// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The section reaches `lib/i18n`, which reads extension storage on import.
vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key, locale: 'en' }),
}));

import { createTheme } from '@/entrypoints/app/theme/create-theme';
import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';
import { AgentSkills } from './agent-skills';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function textPrimaryOf(scheme: 'light' | 'dark') {
  const ink = createTheme().colorSchemes[scheme]?.palette.text.primary;
  if (!ink) throw new Error(`missing ${scheme} text.primary`);
  return ink;
}

/**
 * Renders the band on a light page, as a first visit does. The provider writes
 * `data-color-scheme` on `<html>` from its own mode (light, with nothing
 * stored), over anything set before the render, so the test checks the page
 * scheme instead of setting it.
 */
function renderOnLightPage() {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <ThemeProvider>
        <AgentSkills />
      </ThemeProvider>,
    );
  });

  cleanups.push(() => {
    act(() => root.unmount());
    container.remove();
  });

  return container;
}

// The band forces the dark scheme on its own root (docs/39 Step 5). Two lines
// carry that, and each looks removable: the `data-color-scheme="dark"`
// attribute, which nothing in the file reads, and the `color: text.primary`
// beside it, which reads like a restatement of the body's colour. It is not:
// body resolves `text.primary` in the page's scheme and its descendants inherit
// the resolved ink, so text with no colour of its own, FeatureList's, keeps the
// light ink on the dark band unless the root declares `color` again under its
// own dark variables. Nor can the line move into `applyStyles('dark')` on the
// root: that emits a descendant selector the root itself never matches.
// The title is checked as well, because the bullets alone do not pin where the
// pair sits: moved together onto FeatureList's wrapper, they keep the bullets
// white while the `Headline` head, which sets `text.primary` itself, resolves
// it against the light page and vanishes into the band.
describe('AgentSkills dark band on a light page', () => {
  it('inks the title and FeatureList text with the dark text.primary, not the light one', () => {
    const container = renderOnLightPage();
    const head = container.querySelector('h2');
    const feature = [...container.querySelectorAll('p')].find(
      (p) => p.textContent === 'welcome.agentSkills.feature1',
    );
    if (!head) throw new Error('Headline did not render its h2');
    if (!feature) throw new Error('FeatureList did not render its first item');

    // Control: the page really is light, so the body hands down the light ink
    // and the two inks differ; without it the last two lines could pass on a
    // page that is dark throughout.
    expect(document.documentElement.getAttribute('data-color-scheme')).toBe('light');
    expect(textPrimaryOf('light')).not.toBe(textPrimaryOf('dark'));
    expect(getComputedStyle(document.body).color).toBe(textPrimaryOf('light'));

    expect(getComputedStyle(head).color).toBe(textPrimaryOf('dark'));
    expect(getComputedStyle(feature).color).toBe(textPrimaryOf('dark'));
  });
});
