import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { Iconify } from '../components/iconify';

export type NavItem = {
  title: LocaleKeys;
  path: string;
  /** Top-level items and nested child leaves can carry an icon. */
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
        icon: <Iconify icon="simple-icons:bilibili" width={18} />,
      },
      {
        title: 'nav.githubStars',
        path: '/collections/github',
        icon: <Iconify icon="mdi:github" width={18} />,
      },
      {
        title: 'nav.bookmarks',
        path: '/collections/bookmarks',
        icon: <Iconify icon="solar:bookmark-bold-duotone" width={18} />,
      },
      {
        title: 'nav.xBookmarks',
        path: '/collections/x',
        icon: <Iconify icon="mdi:twitter" width={18} />,
      },
      {
        title: 'nav.zhihuFavorites',
        path: '/collections/zhihu',
        icon: <Iconify icon="simple-icons:zhihu" width={18} />,
      },
      {
        title: 'nav.youtubePlaylists',
        path: '/collections/youtube',
        icon: <Iconify icon="mdi:youtube" width={18} />,
      },
    ],
  },
  {
    title: 'nav.settings',
    path: '/settings',
    icon: <Iconify icon="solar:settings-bold-duotone" width={24} />,
  },
];
