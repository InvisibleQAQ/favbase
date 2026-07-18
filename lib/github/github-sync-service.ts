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
import { escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { items } from '@/lib/database/entities/items';
import { ingestCollection } from '@/lib/ingest/ingest';
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
 * `syncStars`. The transaction skeleton (sources upsert → authors → items →
 * links) is delegated to the shared `ingestCollection` pipeline; this function
 * only declares the normalized rows and reports dropped repos.
 */
export async function syncStarsToDb(
  db: FavbaseDb,
  repos: GithubStarredRepo[],
): Promise<SyncStarsResult> {
  const result = await ingestCollection(db, {
    platform: PLATFORM,
    // The single "stars" source upserts even for an empty star list so the UI
    // can distinguish "never synced" from "synced, empty".
    sources: [{ platformSourceId: STARS_SOURCE_ID, title: STARS_SOURCE_TITLE }],
    authors: repos.map((r) => ({
      platformAuthorId: r.owner.login,
      name: r.owner.login,
      avatarUrl: r.owner.avatarUrl || null,
    })),
    items: repos.map((r) => ({
      platformItemId: String(r.id),
      platformAuthorId: r.owner.login,
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
      } satisfies GithubItemMeta,
    })),
    links: repos.map((r) => ({
      platformItemId: String(r.id),
      platformSourceId: STARS_SOURCE_ID,
    })),
  });

  if (result.droppedItemIds.length > 0) {
    console.warn(
      '[github-sync] %d repos dropped (author mapping miss):',
      result.droppedItemIds.length,
      result.droppedItemIds,
    );
  }
  if (result.droppedLinkItemIds.length > 0) {
    console.warn(
      '[github-sync] %d item_sources dropped (item mapping miss):',
      result.droppedLinkItemIds.length,
      result.droppedLinkItemIds,
    );
  }

  const droppedRepoIds = [...new Set([...result.droppedItemIds, ...result.droppedLinkItemIds])];
  return {
    total: repos.length,
    synced: result.linkCount,
    dropped: droppedRepoIds.length,
    droppedRepoIds,
  };
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
