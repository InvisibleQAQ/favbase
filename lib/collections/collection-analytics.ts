import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type FavbaseDb } from '@/lib/database';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemTags } from '@/lib/database/entities/item-tags';
import { sources } from '@/lib/database/entities/sources';
import { tags } from '@/lib/database/entities/tags';

import {
  COLLECTION_PLATFORMS,
  isCollectionPlatform,
  type CollectionPlatform,
} from './platforms';

const TOP_TAG_LIMIT = 8;
const DIMENSION_ENTRY_LIMIT = 8;

export type CollectionAnalyticsDimensionKind =
  | 'uploader'
  | 'favoriteFolder'
  | 'language'
  | 'repositoryOwner'
  | 'domain'
  | 'folder'
  | 'author'
  | 'collection'
  | 'channel'
  | 'playlist';

export interface CollectionAnalyticsRankedEntry {
  id: string;
  label: string;
  itemCount: number;
}

export interface CollectionAnalyticsDimension {
  kind: CollectionAnalyticsDimensionKind;
  entries: CollectionAnalyticsRankedEntry[];
}

export interface CollectionAnalyticsPlatform {
  platform: CollectionPlatform;
  itemCount: number;
  share: number;
  dimensions: CollectionAnalyticsDimension[];
}

export interface CollectionAnalyticsTag {
  id: string;
  name: string;
  itemCount: number;
}

export interface CollectionAnalyticsSnapshot {
  totalItems: number;
  usedTags: number;
  taggedItems: number;
  platforms: CollectionAnalyticsPlatform[];
  topTags: CollectionAnalyticsTag[];
}

const PLATFORM_DIMENSIONS: Record<
  CollectionPlatform,
  readonly CollectionAnalyticsDimensionKind[]
> = {
  bilibili: ['uploader', 'favoriteFolder'],
  github: ['language', 'repositoryOwner'],
  bookmarks: ['domain', 'folder'],
  x: ['author'],
  zhihu: ['author', 'collection'],
  youtube: ['channel', 'playlist'],
};

const AUTHOR_DIMENSION: Record<CollectionPlatform, CollectionAnalyticsDimensionKind> = {
  bilibili: 'uploader',
  github: 'repositoryOwner',
  bookmarks: 'domain',
  x: 'author',
  zhihu: 'author',
  youtube: 'channel',
};

const SOURCE_DIMENSION: Partial<
  Record<CollectionPlatform, CollectionAnalyticsDimensionKind>
> = {
  bilibili: 'favoriteFolder',
  bookmarks: 'folder',
  zhihu: 'collection',
  youtube: 'playlist',
};

interface RankedRow {
  platform: string;
  id: string;
  label: string;
  itemCount: number;
}

function groupRankedRows(
  rows: RankedRow[],
  dimensionOf: (platform: CollectionPlatform) => CollectionAnalyticsDimensionKind | undefined,
): Map<CollectionPlatform, Map<CollectionAnalyticsDimensionKind, CollectionAnalyticsRankedEntry[]>> {
  const result = new Map<
    CollectionPlatform,
    Map<CollectionAnalyticsDimensionKind, CollectionAnalyticsRankedEntry[]>
  >();

  for (const row of rows) {
    if (!isCollectionPlatform(row.platform)) continue;
    const platform = row.platform;
    const kind = dimensionOf(platform);
    if (!kind) continue;
    const dimensions = result.get(platform) ?? new Map();
    const entries = dimensions.get(kind) ?? [];
    if (entries.length < DIMENSION_ENTRY_LIMIT) {
      entries.push({ id: row.id, label: row.label, itemCount: row.itemCount });
    }
    dimensions.set(kind, entries);
    result.set(platform, dimensions);
  }

  return result;
}

/**
 * Read the current local library as one cohesive analytics snapshot. All
 * metric semantics, platform completion and native-dimension interpretation
 * stay here so consumers render data instead of re-deriving it.
 */
export async function getCollectionAnalytics(
  db: FavbaseDb = getDb(),
): Promise<CollectionAnalyticsSnapshot> {
  const registeredPlatforms = [...COLLECTION_PLATFORMS];
  const registeredItems = inArray(items.platform, registeredPlatforms);

  const [platformRows, tagMetricRows, topTagRows, authorRows, sourceRows, languageRows] =
    await Promise.all([
      db
        .select({
          platform: items.platform,
          itemCount: sql<number>`count(*)::int`,
        })
        .from(items)
        .where(registeredItems)
        .groupBy(items.platform),
      db
        .select({
          usedTags: sql<number>`count(distinct ${itemTags.tagId})::int`,
          taggedItems: sql<number>`count(distinct ${itemTags.itemId})::int`,
        })
        .from(itemTags)
        .innerJoin(items, eq(items.id, itemTags.itemId))
        .where(registeredItems),
      db
        .select({
          id: tags.id,
          name: tags.name,
          itemCount: sql<number>`count(distinct ${itemTags.itemId})::int`,
        })
        .from(tags)
        .innerJoin(itemTags, eq(itemTags.tagId, tags.id))
        .innerJoin(items, eq(items.id, itemTags.itemId))
        .where(registeredItems)
        .groupBy(tags.id, tags.name)
        .orderBy(desc(sql`count(distinct ${itemTags.itemId})`), asc(tags.name), asc(tags.id))
        .limit(TOP_TAG_LIMIT),
      db
        .select({
          platform: items.platform,
          id: authors.id,
          label: authors.name,
          itemCount: sql<number>`count(${items.id})::int`,
        })
        .from(items)
        .innerJoin(authors, eq(authors.id, items.authorId))
        .where(registeredItems)
        .groupBy(items.platform, authors.id, authors.name)
        .orderBy(desc(sql`count(${items.id})`), asc(authors.name), asc(authors.id)),
      db
        .select({
          platform: items.platform,
          id: sources.id,
          label: sources.title,
          itemCount: sql<number>`count(${itemSources.itemId})::int`,
        })
        .from(itemSources)
        .innerJoin(items, eq(items.id, itemSources.itemId))
        .innerJoin(sources, eq(sources.id, itemSources.sourceId))
        .where(sql`${registeredItems} AND ${sources.platform} = ${items.platform}`)
        .groupBy(items.platform, sources.id, sources.title)
        .orderBy(desc(sql`count(${itemSources.itemId})`), asc(sources.title), asc(sources.id)),
      db
        .select({
          platform: items.platform,
          id: sql<string>`${items.platformMeta}->>'language'`,
          label: sql<string>`${items.platformMeta}->>'language'`,
          itemCount: sql<number>`count(*)::int`,
        })
        .from(items)
        .where(
          sql`${items.platform} = 'github'
            AND jsonb_typeof(${items.platformMeta}->'language') = 'string'
            AND btrim(${items.platformMeta}->>'language') <> ''`,
        )
        .groupBy(items.platform, sql`${items.platformMeta}->>'language'`)
        .orderBy(
          desc(sql`count(*)`),
          asc(sql`${items.platformMeta}->>'language'`),
        ),
    ]);

  const itemCountByPlatform = new Map<CollectionPlatform, number>();
  for (const row of platformRows) {
    if (isCollectionPlatform(row.platform)) itemCountByPlatform.set(row.platform, row.itemCount);
  }
  const totalItems = platformRows.reduce((sum, row) => sum + row.itemCount, 0);
  const authorDimensions = groupRankedRows(authorRows, (platform) => AUTHOR_DIMENSION[platform]);
  const sourceDimensions = groupRankedRows(sourceRows, (platform) => SOURCE_DIMENSION[platform]);
  const languageDimensions = groupRankedRows(languageRows, () => 'language');

  const platforms = COLLECTION_PLATFORMS.map((platform) => {
    const itemCount = itemCountByPlatform.get(platform) ?? 0;
    return {
      platform,
      itemCount,
      share: totalItems === 0 ? 0 : itemCount / totalItems,
      dimensions: PLATFORM_DIMENSIONS[platform].map((kind) => ({
        kind,
        entries:
          languageDimensions.get(platform)?.get(kind) ??
          authorDimensions.get(platform)?.get(kind) ??
          sourceDimensions.get(platform)?.get(kind) ??
          [],
      })),
    } satisfies CollectionAnalyticsPlatform;
  });

  return {
    totalItems,
    usedTags: tagMetricRows[0]?.usedTags ?? 0,
    taggedItems: tagMetricRows[0]?.taggedItems ?? 0,
    platforms,
    topTags: topTagRows.map((row) => ({
      id: row.id,
      name: row.name,
      itemCount: row.itemCount,
    })),
  };
}
