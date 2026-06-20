import { Iconify } from '../components/iconify';

export type NavItem = {
  title: string;
  path: string;
  icon: React.ReactNode;
  info?: React.ReactNode;
};

export const navData: NavItem[] = [
  {
    title: 'Dashboard',
    path: '/',
    icon: <Iconify icon="solar:home-angle-bold-duotone" width={24} />,
  },
  {
    title: 'Collections',
    path: '/collections',
    icon: <Iconify icon="solar:videocamera-record-bold-duotone" width={24} />,
  },
  {
    title: 'Settings',
    path: '/settings',
    icon: <Iconify icon="solar:settings-bold-duotone" width={24} />,
  },
];
