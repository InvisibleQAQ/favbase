import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { Iconify } from '../components/iconify';

export type NavItem = {
  title: LocaleKeys;
  path: string;
  /** Top-level items carry an icon; nested child leaves render a dot instead. */
  icon?: React.ReactNode;
  info?: React.ReactNode;
  /** One-level static nesting (e.g. Collections → Bilibili Favorites). */
  children?: NavItem[];
};

export const navData: NavItem[] = [
  {
    title: 'nav.dashboard',
    path: '/',
    icon: <Iconify icon="solar:home-angle-bold-duotone" width={24} />,
  },
  {
    title: 'nav.collections',
    path: '/collections',
    icon: <Iconify icon="solar:videocamera-record-bold-duotone" width={24} />,
    children: [
      {
        title: 'nav.bilibiliFavorites',
        path: '/collections/bilibili',
      },
      {
        title: 'nav.githubStars',
        path: '/collections/github',
      },
      {
        title: 'nav.bookmarks',
        path: '/collections/bookmarks',
      },
      {
        title: 'nav.xBookmarks',
        path: '/collections/x',
      },
    ],
  },
  {
    title: 'nav.settings',
    path: '/settings',
    icon: <Iconify icon="solar:settings-bold-duotone" width={24} />,
  },
];
