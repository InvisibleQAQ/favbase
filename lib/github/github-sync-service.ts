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
 *
 * README content pipeline (text-native, zhihu-isomorphic): `syncStars` diffs
 * the fetched star list against platformItemIds already in the DB and fetches
 * READMEs serially for NEW repos only (100ms pacing; per-repo failures —
 * including non-404 — degrade to no_content with a console.warn, no retry /
 * no backfill, same decision as tagging). README present → `item_contents` +
 * `charSplit` chunks via the shared ingest content channel →
 * `content_state='chunked'` (never 'pending' — that feeds auto-transcribe).
 * Embedding is NOT run inline (D3) — the app.html caller
 * (use-github-stars syncFn) fires `tagNewItems` + `embedNewItems` with
 * `SyncStarsResult.newItemIds` after the sync returns.
 */

import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '@/lib/database';
import type { FavbaseDb } from '@/lib/database';
import { escapeLike } from '@/lib/database/sql-utils';
import { getPlatformLastSyncedAt, pagedItemsQuery } from '@/lib/database/collection-queries';
import { items } from '@/lib/database/entities/items';
import { ingestCollection } from '@/lib/ingest/ingest';
// Leaf import (NOT the '@/lib/embedding' barrel): the barrel eagerly touches
// chrome.storage at module load. charSplit is all this service needs — the
// embedNewItems/tagNewItems seam lives in the app.html caller
// (use-github-stars syncFn). Same rule as lib/x/x-sync-service.ts; keeps
// lib/github's load graph storage-free and its pure tests mock-free.
import { charSplit } from '@/lib/embedding/char-split';
import {
  fetchAllStarred,
  fetchReadme,
  type GithubStarredRepo,
  type StarsProgressCallback,
} from './github-api';

// Re-export only what service consumers actually need: the structured errors
// (hook classifies them) and the types appearing in public signatures below.
// Token validation (validateToken / GithubUser) is a settings-card concern —
// import it from './github-api' directly.
export { GithubAuthError, GithubRateLimitError } from './github-api';
export type { GithubStarredRepo, StarsProgressCallback } from './github-api';

const PLATFORM = 'github';
const STARS_SOURCE_ID = 'stars';
const STARS_SOURCE_TITLE = 'GitHub Stars';
/** Pacing between serial README requests (mirrors PAGE_DELAY_MS in github-api). */
const README_DELAY_MS = 100;
/**
 * Head-preserving cap on persisted README text — guards embedding cost against
 * pathological READMEs. Enforced at the ingest boundary (`textOf`), exported
 * for the guard test.
 */
export const MAX_README_CHARS = 100_000;

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
  /** platformItemIds whose README content was persisted this run — auto-tag/embed input. */
  newItemIds: string[];
}

/** Progress callback for the serial README fetch phase (new repos only). */
export type ReadmeProgressCallback = (done: number, total: number) => void;

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
 * One-shot full sync: fetch ALL starred repos (paged, with progress), diff
 * against the DB to find NEW repos, fetch their READMEs serially, then persist
 * in a single transaction. Star-list fetch/auth errors propagate to the caller
 * (UI shows error state) — nothing is written on failure; per-repo README
 * failures degrade (see `fetchReadmesSerial`).
 */
export async function syncStars(
  token: string,
  onProgress?: StarsProgressCallback,
  onReadmeProgress?: ReadmeProgressCallback,
): Promise<SyncStarsResult> {
  const db = getDb();
  const repos = await fetchAllStarred(token, onProgress);
  const newRepos = await getNewRepos(db, repos);
  const readmeById = await fetchReadmesSerial(token, newRepos, onReadmeProgress);
  return syncStarsToDb(db, repos, readmeById);
}

/**
 * Repos whose platformItemId is not yet in the DB — the README fetch diff:
 * already-ingested repos never get a second README request (insert-only means
 * their content could not be written anyway). Exported for the guard test;
 * `syncStars` is the sole production caller.
 */
export async function getNewRepos(
  db: FavbaseDb,
  repos: GithubStarredRepo[],
): Promise<GithubStarredRepo[]> {
  const rows = await db
    .select({ platformItemId: items.platformItemId })
    .from(items)
    .where(eq(items.platform, PLATFORM));
  const existing = new Set(rows.map((r) => r.platformItemId));
  return repos.filter((r) => !existing.has(String(r.id)));
}

/**
 * Serial README fetch for the diffed new repos — 100ms pacing between
 * requests. Tolerant degradation (user-confirmed): ANY per-repo failure
 * (network / 5xx / rate limit, not just 404) logs a console.warn and treats
 * the repo as README-less; the sync never aborts. No retry, no backfill —
 * same "宁缺毋滥" decision as tagging.
 */
async function fetchReadmesSerial(
  token: string,
  repos: GithubStarredRepo[],
  onProgress?: ReadmeProgressCallback,
): Promise<Map<string, string>> {
  const readmeById = new Map<string, string>();
  if (repos.length === 0) return readmeById;

  onProgress?.(0, repos.length);
  for (let i = 0; i < repos.length; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, README_DELAY_MS));
    const repo = repos[i];
    try {
      const readme = await fetchReadme(token, repo.fullName);
      if (readme?.trim()) readmeById.set(String(repo.id), readme);
    } catch (err) {
      console.warn(
        '[github-sync] README fetch failed for %s (degrading to no_content):',
        repo.fullName,
        err,
      );
    }
    onProgress?.(i + 1, repos.length);
  }
  return readmeById;
}

/**
 * Persist starred repos (+ optional README markdown for new ones). Exported
 * for tests — production code goes through `syncStars`. The transaction
 * skeleton (sources upsert → authors → items → links → two-phase content
 * write) is delegated to the shared `ingestCollection` pipeline; this function
 * only declares the normalized rows and reports dropped repos.
 */
export async function syncStarsToDb(
  db: FavbaseDb,
  repos: GithubStarredRepo[],
  readmeById?: Map<string, string>,
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
      // Text-native when a README exists (zhihu-isomorphic): README → chunked;
      // absent / fetch-failed → no_content (NOT pending — that feeds
      // auto-transcribe).
      contentState: readmeById?.get(String(r.id))
        ? ('chunked' as const)
        : ('no_content' as const),
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
    // README markdown for newly inserted repos (the pipeline skips
    // pre-existing items and empty text). Head-preserving truncation lives
    // HERE — the single enforcement point at the persistence boundary.
    content: {
      textOf: (pid) => (readmeById?.get(pid) ?? '').slice(0, MAX_README_CHARS),
      chunk: (text) => charSplit(text, { preferParagraph: true }),
    },
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
    newItemIds: result.contentPersisted,
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

/**
 * Defensive platformMeta → GithubRepoItem field narrowing, the SINGLE source of
 * truth shared by the query mapRow (below) and the section tagged-repo-card
 * adapter. Envelope fields (id/repoId/fullName/ownerLogin/htmlUrl) stay at each
 * call site; GitHub has no envelope-fallback fields.
 */
export type NarrowedGithubMeta = Omit<
  GithubRepoItem,
  'id' | 'repoId' | 'fullName' | 'ownerLogin' | 'htmlUrl'
>;

export function narrowGithubMeta(meta: unknown): NarrowedGithubMeta {
  const m = (meta ?? {}) as Record<string, unknown>;
  return {
    description: typeof m.description === 'string' ? m.description : null,
    language: typeof m.language === 'string' ? m.language : null,
    stargazersCount: typeof m.stargazersCount === 'number' ? m.stargazersCount : 0,
    forksCount: typeof m.forksCount === 'number' ? m.forksCount : 0,
    topics: Array.isArray(m.topics) ? (m.topics as string[]) : [],
    pushedAt: typeof m.pushedAt === 'string' ? m.pushedAt : null,
    starredAt: typeof m.starredAt === 'string' ? m.starredAt : null,
    ownerAvatarUrl: typeof m.ownerAvatarUrl === 'string' ? m.ownerAvatarUrl : null,
  };
}

function toRepoItem(row: {
  id: string;
  platformItemId: string;
  title: string;
  authorName: string;
  originalUrl: string;
  platformMeta: unknown;
}): GithubRepoItem {
  return {
    id: row.id,
    repoId: row.platformItemId,
    fullName: row.title,
    ownerLogin: row.authorName,
    htmlUrl: row.originalUrl,
    ...narrowGithubMeta(row.platformMeta),
  };
}
