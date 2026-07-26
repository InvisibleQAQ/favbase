import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { collectionPlatformRegistry } from '../collection-platform-registry';
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
    children: collectionPlatformRegistry.map(({ title, path, icon }) => ({
      title,
      path,
      icon: <Iconify icon={icon} width={18} />,
    })),
  },
  {
    title: 'nav.chat',
    path: '/chat',
    icon: <Iconify icon="solar:chat-round-dots-bold" width={24} />,
  },
  {
    title: 'nav.settings',
    path: '/settings',
    icon: <Iconify icon="solar:settings-bold-duotone" width={24} />,
  },
];
