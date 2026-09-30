import { asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { getDb, type FavbaseDb } from '@/lib/database';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { itemTags } from '@/lib/database/entities/item-tags';
import { sources } from '@/lib/database/entities/sources';
import { tags } from '@/lib/database/entities/tags';

import type { CollectionAnalyticsDimensionKind } from './analytics-types';
import { PLATFORM_DESCRIPTORS } from './platform-descriptor';
import {
  COLLECTION_PLATFORMS,
  isCollectionPlatform,
  type CollectionPlatform,
} from './platforms';

// Re-exported so every existing consumer (and the `@/lib/collections` barrel)
// keeps naming the Kind through this module.
export type { CollectionAnalyticsDimensionKind };

const TOP_TAG_LIMIT = 8;
const DIMENSION_ENTRY_LIMIT = 8;

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

interface RankedRow {
  platform: string;
  id: string;
  label: string;
  itemCount: number;
}

function groupRankedRows(
  rows: RankedRow[],
  dimensionOf: (platform: CollectionPlatform) => CollectionAnalyticsDimensionKind | null,
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
 * One platform's `dimensions.meta` facet: every non-blank JSON-string value of
 * `platform_meta->field`, counted per value, `count desc, value asc`. Platform
 * and key both come from the descriptor, so neither is written here.
 *
 * The key is a bound parameter, which is why the value is projected once in a
 * subquery: `platform_meta->>$n` in SELECT, GROUP BY and ORDER BY would be
 * three different parameters, and Postgres would reject them as three
 * different expressions ("must appear in the GROUP BY clause").
 */
function metaDimensionRows(
  db: FavbaseDb,
  platform: CollectionPlatform,
  field: string,
): Promise<RankedRow[]> {
  const values = db
    .select({
      platform: items.platform,
      value: sql<string>`${items.platformMeta}->>${field}`.as('value'),
    })
    .from(items)
    .where(
      sql`${items.platform} = ${platform}
        AND jsonb_typeof(${items.platformMeta}->${field}) = 'string'
        AND btrim(${items.platformMeta}->>${field}) <> ''`,
    )
    .as('meta_values');
  return db
    .select({
      platform: values.platform,
      id: values.value,
      label: values.value,
      itemCount: sql<number>`count(*)::int`,
    })
    .from(values)
    .groupBy(values.platform, values.value)
    .orderBy(desc(sql`count(*)`), asc(values.value));
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

  const [platformRows, tagMetricRows, topTagRows, authorRows, sourceRows, metaRows] =
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
      Promise.all(
        COLLECTION_PLATFORMS.flatMap((platform) => {
          const facet = PLATFORM_DESCRIPTORS[platform].dimensions.meta;
          return facet ? [metaDimensionRows(db, platform, facet.field)] : [];
        }),
      ).then((rows) => rows.flat()),
    ]);

  const itemCountByPlatform = new Map<CollectionPlatform, number>();
  for (const row of platformRows) {
    if (isCollectionPlatform(row.platform)) itemCountByPlatform.set(row.platform, row.itemCount);
  }
  const totalItems = platformRows.reduce((sum, row) => sum + row.itemCount, 0);
  const authorDimensions = groupRankedRows(
    authorRows,
    (platform) => PLATFORM_DESCRIPTORS[platform].dimensions.author,
  );
  const sourceDimensions = groupRankedRows(
    sourceRows,
    (platform) => PLATFORM_DESCRIPTORS[platform].dimensions.source,
  );
  const metaDimensions = groupRankedRows(
    metaRows,
    (platform) => PLATFORM_DESCRIPTORS[platform].dimensions.meta?.kind ?? null,
  );

  const platforms = COLLECTION_PLATFORMS.map((platform) => {
    const itemCount = itemCountByPlatform.get(platform) ?? 0;
    return {
      platform,
      itemCount,
      share: totalItems === 0 ? 0 : itemCount / totalItems,
      dimensions: PLATFORM_DESCRIPTORS[platform].dimensions.ranked.map((kind) => ({
        kind,
        entries:
          metaDimensions.get(platform)?.get(kind) ??
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
