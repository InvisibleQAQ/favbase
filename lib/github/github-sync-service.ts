/**
 * GitHub domain sync service — the ONLY holder of DB schema knowledge for
 * the github platform (mirrors lib/bilibili/bili-sync-service.ts layering).
 * Consumers (hooks / UI) call the high-level operations here and never
 * import drizzle / entities / getDb themselves.
 *
 * Insert-only ADR (.trellis/spec/frontend/database-bridge.md) applies:
 * items / authors / item_sources are insert-only (`onConflictDoNothing`,
 * first-write-wins). Allowed exception: the `sources` row is upserted to
 * refresh lastFetchedAt. Unstarred repos are never deleted (knowledge base
 * keeps everything).
 */

import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { chunk, escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { sources } from '@/lib/database/entities/sources';
import { authors } from '@/lib/database/entities/authors';
import { items } from '@/lib/database/entities/items';
import { itemSources } from '@/lib/database/entities/item-sources';
import { fetchAllStarred, type GithubStarredRepo, type StarsProgressCallback } from './github-api';

// Re-export only what service consumers actually need: the structured errors
// (hook classifies them) and the types appearing in public signatures below.
// Token validation (validateToken / GithubUser) is a settings-card concern —
// import it from './github-api' directly.
export { GithubAuthError, GithubRateLimitError } from './github-api';
export type { GithubStarredRepo, StarsProgressCallback } from './github-api';

const PLATFORM = 'github';
const STARS_SOURCE_ID = 'stars';
const STARS_SOURCE_TITLE = 'GitHub Stars';
/** Rows per INSERT batch — keeps bind-param count well under the PG 65535 limit. */
const INSERT_CHUNK_SIZE = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** platformMeta shape written to items rows (single source of truth: this file). */
interface GithubItemMeta {
  description: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  topics: string[];
  pushedAt: string | null;
  starredAt: string;
  ownerAvatarUrl: string;
}

export interface SyncStarsResult {
  total: number;
  synced: number;
  dropped: number;
  droppedRepoIds: string[];
}

/** Row shape returned to the UI — zero drizzle knowledge required downstream. */
export interface GithubRepoItem {
  /** items.id (uuid) */
  id: string;
  /** GitHub repo id (items.platformItemId) */
  repoId: string;
  fullName: string;
  ownerLogin: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  topics: string[];
  pushedAt: string | null;
  starredAt: string | null;
  ownerAvatarUrl: string | null;
}

export interface StarredReposQuery {
  /** Exact match on platformMeta language (chip filter). */
  language?: string;
  /** ILIKE match on full_name (title) or description. */
  search?: string;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}

export interface LanguageCount {
  language: string;
  count: number;
}

// ---------------------------------------------------------------------------
// Public API — sync
// ---------------------------------------------------------------------------

/**
 * One-shot full sync: fetch ALL starred repos (paged, with progress), then
 * persist in a single transaction. Fetch/auth errors propagate to the caller
 * (UI shows error state) — nothing is written on failure.
 */
export async function syncStars(
  token: string,
  onProgress?: StarsProgressCallback,
): Promise<SyncStarsResult> {
  const repos = await fetchAllStarred(token, onProgress);
  return syncStarsToDb(getDb(), repos);
}

/**
 * Persist starred repos. Exported for tests — production code goes through
 * `syncStars`. Single transaction, five steps mirroring videos-sync:
 * sources upsert → authors insert → author map → items insert → links insert.
 */
export async function syncStarsToDb(
  db: FavbaseDb,
  repos: GithubStarredRepo[],
): Promise<SyncStarsResult> {
  return db.transaction(async (tx) => {
    // 1. Upsert the single "stars" source row (ADR-allowed exception:
    //    lastFetchedAt freshness). Runs even for an empty star list so the
    //    UI can distinguish "never synced" from "synced, empty".
    const sourceRows = await tx
      .insert(sources)
      .values({
        platform: PLATFORM,
        platformSourceId: STARS_SOURCE_ID,
        title: STARS_SOURCE_TITLE,
        lastFetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [sources.platform, sources.platformSourceId],
        set: {
          lastFetchedAt: sql`excluded.last_fetched_at`,
          updatedAt: sql`NOW()`,
        },
      })
      .returning({ id: sources.id });
    const sourceId = sourceRows[0].id;

    if (repos.length === 0) {
      return { total: 0, synced: 0, dropped: 0, droppedRepoIds: [] };
    }

    // 2. Deduplicate owners by login, insert-only.
    const ownerMap = new Map<string, GithubStarredRepo['owner']>();
    for (const r of repos) {
      if (!ownerMap.has(r.owner.login)) ownerMap.set(r.owner.login, r.owner);
    }

    const authorValues = [...ownerMap.values()].map((owner) => ({
      platform: PLATFORM,
      platformAuthorId: owner.login,
      name: owner.login,
      avatarUrl: owner.avatarUrl || null,
    }));

    for (const batch of chunk(authorValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(authors)
        .values(batch)
        .onConflictDoNothing({ target: [authors.platform, authors.platformAuthorId] });
    }

    // 3. Build login → author id map (select by platform: avoids giant
    //    inArray param lists; the github author set IS the set we need).
    const authorRows = await tx
      .select({ id: authors.id, platformAuthorId: authors.platformAuthorId })
      .from(authors)
      .where(eq(authors.platform, PLATFORM));
    const authorIdMap = new Map(authorRows.map((r) => [r.platformAuthorId, r.id]));

    // 4. Insert items — insert-only, first-write-wins.
    const droppedByAuthor: string[] = [];
    const itemValues: Array<{
      platform: string;
      platformItemId: string;
      authorId: string;
      title: string;
      authorName: string;
      originalUrl: string;
      publishedAt: Date | null;
      contentState: 'no_content';
      platformMeta: GithubItemMeta;
    }> = [];

    for (const r of repos) {
      const authorId = authorIdMap.get(r.owner.login);
      if (!authorId) {
        droppedByAuthor.push(String(r.id));
        continue;
      }
      itemValues.push({
        platform: PLATFORM,
        platformItemId: String(r.id),
        authorId,
        title: r.fullName,
        authorName: r.owner.login,
        originalUrl: r.htmlUrl,
        publishedAt: r.createdAt ? new Date(r.createdAt) : null,
        contentState: 'no_content' as const,
        platformMeta: {
          description: r.description,
          language: r.language,
          stargazersCount: r.stargazersCount,
          forksCount: r.forksCount,
          topics: r.topics,
          pushedAt: r.pushedAt,
          starredAt: r.starredAt,
          ownerAvatarUrl: r.owner.avatarUrl,
        },
      });
    }

    if (droppedByAuthor.length > 0) {
      console.warn(
        '[github-sync] %d repos dropped (author mapping miss):',
        droppedByAuthor.length,
        droppedByAuthor,
      );
    }

    for (const batch of chunk(itemValues, INSERT_CHUNK_SIZE)) {
      await tx
        .insert(items)
        .values(batch)
        .onConflictDoNothing({ target: [items.platform, items.platformItemId] });
    }

    // 5. Build repoId → item id map, insert item_sources links.
    const itemRows = await tx
      .select({ id: items.id, platformItemId: items.platformItemId })
      .from(items)
      .where(eq(items.platform, PLATFORM));
    const itemIdMap = new Map(itemRows.map((r) => [r.platformItemId, r.id]));

    const droppedByItem: string[] = [];
    const linkValues: Array<{ itemId: string; sourceId: string }> = [];
    for (const r of repos) {
      const itemId = itemIdMap.get(String(r.id));
      if (!itemId) {
        if (!droppedByAuthor.includes(String(r.id))) droppedByItem.push(String(r.id));
        continue;
      }
      linkValues.push({ itemId, sourceId });
    }

    if (droppedByItem.length > 0) {
      console.warn(
        '[github-sync] %d item_sources dropped (item mapping miss):',
        droppedByItem.length,
        droppedByItem,
      );
    }

    for (const batch of chunk(linkValues, INSERT_CHUNK_SIZE)) {
      await tx.insert(itemSources).values(batch).onConflictDoNothing();
    }

    const droppedRepoIds = [...new Set([...droppedByAuthor, ...droppedByItem])];
    return {
      total: repos.length,
      synced: linkValues.length,
      dropped: droppedRepoIds.length,
      droppedRepoIds,
    };
  });
}

// ---------------------------------------------------------------------------
// Public API — queries (GitHub collections page reads from PGlite, not the API)
// ---------------------------------------------------------------------------

/**
 * Paged starred repos, starred_at descending (ISO strings — lexicographic
 * order IS chronological order). Optional language chip filter + ILIKE search
 * over full_name / description.
 */
export async function getStarredRepos(
  query: StarredReposQuery,
  db: FavbaseDb = getDb(),
): Promise<{ rows: GithubRepoItem[]; total: number }> {
  const conditions: (SQL | undefined)[] = [eq(items.platform, PLATFORM)];

  if (query.language) {
    conditions.push(sql`${items.platformMeta}->>'language' = ${query.language}`);
  }
  if (query.search?.trim()) {
    const pattern = `%${escapeLike(query.search.trim())}%`;
    conditions.push(
      or(
        ilike(items.title, pattern),
        sql`${items.platformMeta}->>'description' ILIKE ${pattern}`,
      ),
    );
  }

  return pagedItemsQuery(db, {
    conditions,
    orderBy: desc(sql`${items.platformMeta}->>'starredAt'`),
    page: query.page,
    pageSize: query.pageSize,
    mapRow: toRepoItem,
  });
}

/** Distinct languages with repo counts, descending — data for the chip row. */
export async function getLanguageCounts(db: FavbaseDb = getDb()): Promise<LanguageCount[]> {
  const langExpr = sql`${items.platformMeta}->>'language'`;
  const rows = await db
    .select({
      language: sql<string>`${langExpr}`,
      count: sql<number>`count(*)::int`,
    })
    .from(items)
    .where(and(eq(items.platform, PLATFORM), sql`${langExpr} IS NOT NULL`))
    .groupBy(langExpr)
    .orderBy(desc(sql`count(*)`), sql`${langExpr}`);
  return rows;
}

/** When the stars source was last synced; null = never synced. */
export async function getLastSyncedAt(db: FavbaseDb = getDb()): Promise<Date | null> {
  return getPlatformLastSyncedAt(PLATFORM, db);
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

function toRepoItem(row: {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  platformMeta: unknown;
}): GithubRepoItem {
  const meta = (row.platformMeta ?? {}) as Partial<GithubItemMeta>;
  return {
    id: row.id,
    repoId: row.platformItemId,
    fullName: row.title,
    ownerLogin: row.authorName,
    htmlUrl: row.originalUrl,
    description: meta.description ?? null,
    language: meta.language ?? null,
    stargazersCount: typeof meta.stargazersCount === 'number' ? meta.stargazersCount : 0,
    forksCount: typeof meta.forksCount === 'number' ? meta.forksCount : 0,
    topics: Array.isArray(meta.topics) ? meta.topics : [],
    pushedAt: meta.pushedAt ?? null,
    starredAt: meta.starredAt ?? null,
    ownerAvatarUrl: meta.ownerAvatarUrl ?? null,
  };
}
