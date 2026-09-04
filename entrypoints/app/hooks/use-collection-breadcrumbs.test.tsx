// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BreadcrumbsLinkProps } from '../components/custom-breadcrumbs';

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({
    locale: 'en',
    preference: 'en',
    setLocale: vi.fn(),
    t: (key: string) =>
      ({
        'breadcrumbs.home': 'Home',
        'nav.collections': 'Collections',
        'nav.bilibiliFavorites': 'Bilibili Favorites',
        'nav.githubStars': 'GitHub Stars',
      })[key] ?? key,
  }),
}));

import { useCollectionBreadcrumbs } from './use-collection-breadcrumbs';

describe('useCollectionBreadcrumbs', () => {
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

  function trailOf(...args: Parameters<typeof useCollectionBreadcrumbs>) {
    let links: BreadcrumbsLinkProps[] = [];
    function Probe() {
      links = useCollectionBreadcrumbs(...args);
      return null;
    }
    act(() => root.render(<Probe />));
    return links;
  }

  it('names the aggregate page itself as the trailing crumb', () => {
    expect(trailOf(null)).toEqual([
      { name: 'Home', href: '/' },
      { name: 'Collections' },
    ]);
  });

  it('reads the platform crumb off the navigation registry', () => {
    expect(trailOf('github')).toEqual([
      { name: 'Home', href: '/' },
      { name: 'Collections', href: '/collections' },
      { name: 'GitHub Stars' },
    ]);
  });

  it('keeps the platform crumb linkable when a deeper leaf owns the page', () => {
    expect(trailOf('bilibili', 'Default folder')).toEqual([
      { name: 'Home', href: '/' },
      { name: 'Collections', href: '/collections' },
      { name: 'Bilibili Favorites', href: '/collections/bilibili' },
      { name: 'Default folder' },
    ]);
  });
});
