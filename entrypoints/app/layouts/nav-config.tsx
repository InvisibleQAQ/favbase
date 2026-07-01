import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { Iconify } from '../components/iconify';

export type NavItem = {
  title: LocaleKeys;
  path: string;
  icon: React.ReactNode;
  info?: React.ReactNode;
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
  },
  {
    title: 'nav.settings',
    path: '/settings',
    icon: <Iconify icon="solar:settings-bold-duotone" width={24} />,
  },
];
