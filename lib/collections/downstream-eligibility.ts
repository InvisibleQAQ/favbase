import { sql, type SQL } from 'drizzle-orm';

import { items } from '@/lib/database/entities/items';

import type { CollectionPlatform } from './platforms';

const ALL_ITEMS = sql<boolean>`true`;
const DOWNSTREAM_ELIGIBILITY: Record<CollectionPlatform, SQL<boolean>> = {
  bilibili: sql<boolean>`coalesce(${items.platformMeta}->>'attr', '') <> '9'`,
  github: ALL_ITEMS,
  bookmarks: ALL_ITEMS,
  x: ALL_ITEMS,
  zhihu: ALL_ITEMS,
  youtube: ALL_ITEMS,
};

/** Shared SQL fact for Collection work that may proceed past acquisition. */
export function getDownstreamEligibilityCondition(
  platform: CollectionPlatform,
): SQL<boolean> {
  return DOWNSTREAM_ELIGIBILITY[platform];
}
