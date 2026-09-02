import { useMemo } from 'react';

import { t } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';

import type { NavGroup, NavItem } from '../nav-config';
import type { NavItemDataProps, NavSectionData } from '../../components/nav-section';

/**
 * The i18n boundary for the sidebar: `nav-config.tsx` stores locale keys (it
 * runs once at bootstrap, before any React render), `components/nav-section/`
 * only ever sees display strings. Doing it here means both rails and the mobile
 * drawer share one translated tree instead of three `t()` call sites inside the
 * ported components.
 */
function translateItem(item: NavItem): NavItemDataProps {
  const title = t(item.title);

  return {
    path: item.path,
    title,
    icon: item.icon,
    info: item.info,
    caption: item.caption ? t(item.caption) : undefined,
    platform: item.platform,
    external: item.external,
    deepMatch: item.deepMatch,
    toggleLabel: item.children ? t('nav.toggleSubmenuAria', { title }) : undefined,
    children: item.children?.map(translateItem),
  };
}

export function useTranslatedNav(data: NavGroup[]): NavSectionData[] {
  // `t` reads the module-level message table, so `locale` — not `t` — is the
  // dependency that must rebuild the tree on a language switch.
  const { locale } = useTranslation();

  return useMemo(
    () =>
      data.map((group) => ({
        subheader: t(group.subheader),
        items: group.items.map(translateItem),
      })),
    [data, locale],
  );
}
