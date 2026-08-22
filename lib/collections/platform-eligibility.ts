import type { SQL } from 'drizzle-orm';

import { bilibiliDownstreamEligibleSql } from '@/lib/bilibili/video-eligibility';

import type { CollectionPlatform } from './platforms';

/**
 * Per-platform predicate deciding whether a persisted Item may enter the
 * downstream stages (Content → Embedding → Tags). `null` means the platform
 * has no exclusion of its own. The rule itself lives with the platform that
 * owns the `platform_meta` shape; this table only registers it, so the shared
 * policy never names a platform or a JSONB field.
 */
export type PlatformDownstreamEligibility = Readonly<Record<CollectionPlatform, SQL | null>>;

export const PLATFORM_DOWNSTREAM_ELIGIBILITY: PlatformDownstreamEligibility = {
  bilibili: bilibiliDownstreamEligibleSql(),
  github: null,
  bookmarks: null,
  x: null,
  zhihu: null,
  youtube: null,
};
