import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import { PLATFORM_REQUEST_ISSUE_URL } from '@/lib/repo';
import { collectionPlatformRegistry } from '../collection-platform-registry';
import { Iconify } from '../components/iconify';

export type NavItem = {
  title: LocaleKeys;
  path: string;
  /** Top-level items and nested child leaves can carry an icon. */
  icon?: React.ReactNode;
  info?: React.ReactNode;
  /**
   * Outbound action link: opens `path` (a full URL) in a new tab instead of
   * routing. Active-route matching never hits a URL, so it never highlights.
   */
  external?: true;
  /** One-level static nesting (e.g. Collections → Bilibili Favorites). */
  children?: NavItem[];
};

export function createNavData(
  preferredPlatforms: readonly CollectionPlatform[] = [],
): NavItem[] {
  const preferred = new Set<CollectionPlatform>(preferredPlatforms);
  const orderedPlatforms = [
    ...collectionPlatformRegistry.filter(({ id }) => preferred.has(id)),
    ...collectionPlatformRegistry.filter(({ id }) => !preferred.has(id)),
  ];

  return [
    {
      title: 'nav.collections',
      path: '/collections',
      icon: <Iconify icon="solar:videocamera-record-bold-duotone" width={24} />,
      children: [
        ...orderedPlatforms.map(({ title, path, icon }) => ({
          title,
          path,
          icon: <Iconify icon={icon} width={18} />,
        })),
        // Platform Request (CONTEXT.md): an action link, not a platform — kept
        // out of collectionPlatformRegistry so it never leaks into aggregation,
        // sync, or the welcome picker.
        {
          title: 'nav.requestPlatform',
          path: PLATFORM_REQUEST_ISSUE_URL,
          external: true,
          icon: <Iconify icon="mingcute:add-line" width={18} />,
        },
      ],
    },
    {
      title: 'nav.dashboard',
      path: '/',
      icon: <Iconify icon="solar:home-angle-bold-duotone" width={24} />,
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
}
