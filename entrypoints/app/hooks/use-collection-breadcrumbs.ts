import type { CollectionPlatform } from '@/lib/collections/platforms';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { BreadcrumbsLinkProps } from '../components/custom-breadcrumbs';
import { collectionPlatformById } from '../collection-platform-registry';

/**
 * Ancestry for a collection route, mirroring the sidebar hierarchy:
 * Home → Collections → platform → (optional deeper leaf).
 *
 * Crumb names come from `collectionPlatformRegistry`, so a page's trail always
 * reads like the nav item that leads to it; `hrefs` are router-relative
 * (`RouterLink` adds the hash router's `#`).
 *
 * `platform` is `null` on the aggregate `/collections` page. `leaf` names a
 * level below the platform page (bilibili's folder route) — omit it and the
 * platform itself is the page.
 *
 * Translated fresh on every render: `t` is a stable module function, so the
 * only thing that re-runs this hook on a locale switch is the re-render
 * `useTranslation()` subscribes us to. Memoizing on `t` would freeze the
 * strings in the old locale.
 */
export function useCollectionBreadcrumbs(
  platform: CollectionPlatform | null,
  leaf?: string,
): BreadcrumbsLinkProps[] {
  const { t } = useTranslation();
  const config = platform ? collectionPlatformById.get(platform) : undefined;

  const trail = [
    { name: t('breadcrumbs.home'), href: '/' },
    { name: t('nav.collections'), href: '/collections' },
    ...(config ? [{ name: t(config.title), href: config.path }] : []),
  ];

  // The trailing crumb names the page you are already on, so it carries no
  // href (`BreadcrumbsLink` renders it inert with `aria-current="page"`).
  const pageName = leaf ?? trail[trail.length - 1].name;
  const ancestors = leaf === undefined ? trail.slice(0, -1) : trail;

  return [...ancestors, { name: pageName }];
}
