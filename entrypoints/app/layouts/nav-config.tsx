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
  /** Collection platform identity used by the sidebar icon color contract. */
  platform?: CollectionPlatform;
  info?: React.ReactNode;
  /** Secondary line under the title (vertical) / tooltip glyph (mini). */
  caption?: LocaleKeys;
  /** Stay active on nested routes, e.g. `/collections/bilibili/:mediaId`. */
  deepMatch?: boolean;
  /**
   * Outbound action link: opens `path` (a full URL) in a new tab instead of
   * routing. Active-route matching never hits a URL, so it never highlights.
   */
  external?: true;
  /** One-level static nesting (e.g. Collections → Bilibili Favorites). */
  children?: NavItem[];
};

/** A titled group of top-level items (docs/25 D16). */
export type NavGroup = {
  subheader: LocaleKeys;
  items: NavItem[];
};

export function createNavData(
  preferredPlatforms: readonly CollectionPlatform[] = [],
): NavGroup[] {
  const preferred = new Set<CollectionPlatform>(preferredPlatforms);
  const orderedPlatforms = [
    ...collectionPlatformRegistry.filter(({ id }) => preferred.has(id)),
    ...collectionPlatformRegistry.filter(({ id }) => !preferred.has(id)),
  ];

  return [
    {
      subheader: 'nav.groupCollections',
      items: [
        {
          title: 'nav.collections',
          path: '/collections',
          icon: <Iconify icon="solar:videocamera-record-bold-duotone" width={24} />,
          children: [
            ...orderedPlatforms.map(({ id, title, path, icon }) => ({
              title,
              path,
              platform: id,
              // Detail routes (`/collections/bilibili/:mediaId`) belong to their
              // platform leaf; see COLLECTION_PAGE_CHILD_ROUTES.
              deepMatch: true,
              icon: <Iconify icon={icon} width={18} />,
            })),
            // Platform Request (CONTEXT.md): an action link, not a platform — kept
            // out of collectionPlatformRegistry so it never leaks into aggregation,
            // sync, or the welcome picker.
            {
              title: 'nav.requestPlatform',
              path: PLATFORM_REQUEST_ISSUE_URL,
              external: true,
              caption: 'nav.externalCaption',
              icon: <Iconify icon="mingcute:add-line" width={18} />,
              info: <Iconify icon="eva:diagonal-arrow-right-up-fill" width={14} />,
            },
          ],
        },
      ],
    },
    {
      subheader: 'nav.groupGeneral',
      items: [
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
      ],
    },
  ];
}
