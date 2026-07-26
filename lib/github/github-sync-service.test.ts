import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';

import {
  syncStarsToDb,
  getReposNeedingReadme,
  getStarredRepos,
  getLanguageCounts,
  getLastSyncedAt,
  MAX_README_CHARS,
} from './github-sync-service';
import type { GithubStarredRepo } from './github-api';

// ---------------------------------------------------------------------------
// Insert-only invariant (first-write-wins) for the github platform. Mirrors
// lib/bilibili/videos-sync.test.ts — see ADR in
// .trellis/spec/frontend/database-bridge.md. Re-sync must never update or
// delete rows in items / authors / item_sources. The single `sources` row is
// the allowed upsert exception (lastFetchedAt freshness).
// ---------------------------------------------------------------------------

function makeRepo(overrides: Partial<GithubStarredRepo> & { id: number }): GithubStarredRepo {
  return {
    fullName: `alice/repo-${overrides.id}`,
    htmlUrl: `https://github.com/alice/repo-${overrides.id}`,
    description: 'original description',
    language: 'TypeScript',
    stargazersCount: 100,
    forksCount: 10,
    topics: ['cli', 'tooling'],
    createdAt: '2024-01-01T00:00:00Z',
    pushedAt: '2024-06-01T00:00:00Z',
    starredAt: '2024-07-01T00:00:00Z',
    owner: { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/alice' },
    ...overrides,
  };
}

describe('github-sync-service (in-memory PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
  });

  afterAll(async () => {
    await pg.close();
  });

  // FK-safe cleanup order — no state leaks across tests.
  afterEach(async () => {
    await db.delete(schema.itemChunks);
    await db.delete(schema.itemContents);
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    await db.delete(schema.authors);
    await db.delete(schema.sources);
  });

  async function getItem(repoId: number) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(
        and(eq(schema.items.platform, 'github'), eq(schema.items.platformItemId, String(repoId))),
      );
    return rows[0];
  }

  async function getAuthor(login: string) {
    const rows = await db
      .select()
      .from(schema.authors)
      .where(
        and(eq(schema.authors.platform, 'github'), eq(schema.authors.platformAuthorId, login)),
      );
    return rows[0];
  }

  async function getStarsSource() {
    const rows = await db
      .select()
      .from(schema.sources)
      .where(
        and(eq(schema.sources.platform, 'github'), eq(schema.sources.platformSourceId, 'stars')),
      );
    return rows[0];
  }

  // -------------------------------------------------------------------------
  // First sync
  // -------------------------------------------------------------------------

  it('first sync persists sources / authors / items / item_sources correctly', async () => {
    const repos = [
      makeRepo({ id: 1 }),
      makeRepo({ id: 2, fullName: 'alice/repo-2', language: 'Rust' }),
      makeRepo({
        id: 3,
        fullName: 'bob/other',
        htmlUrl: 'https://github.com/bob/other',
        owner: { login: 'bob', avatarUrl: 'https://avatars.githubusercontent.com/bob' },
      }),
    ];

    const result = await syncStarsToDb(db, repos);
    expect(result).toMatchObject({ total: 3, synced: 3, dropped: 0 });
    // No readmeById → nothing content-persisted, auto-tag/embed get an empty batch.
    expect(result.newItemIds).toEqual([]);

    // sources: single upserted "stars" row
    const source = await getStarsSource();
    expect(source).toBeDefined();
    expect(source.title).toBe('GitHub Stars');
    expect(source.lastFetchedAt).not.toBeNull();

    // authors: owner dedupe — alice appears twice but gets one row
    const authorRows = await db
      .select()
      .from(schema.authors)
      .where(eq(schema.authors.platform, 'github'));
    expect(authorRows).toHaveLength(2);
    const alice = await getAuthor('alice');
    expect(alice.name).toBe('alice');
    expect(alice.avatarUrl).toBe('https://avatars.githubusercontent.com/alice');

    // items: field mapping + platformMeta shape
    const item = await getItem(1);
    expect(item.title).toBe('alice/repo-1');
    expect(item.authorName).toBe('alice');
    expect(item.originalUrl).toBe('https://github.com/alice/repo-1');
    expect(item.contentState).toBe('no_content');
    expect(item.publishedAt?.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(item.platformMeta).toEqual({
      description: 'original description',
      language: 'TypeScript',
      stargazersCount: 100,
      forksCount: 10,
      topics: ['cli', 'tooling'],
      pushedAt: '2024-06-01T00:00:00Z',
      starredAt: '2024-07-01T00:00:00Z',
      ownerAvatarUrl: 'https://avatars.githubusercontent.com/alice',
    });

    // item_sources: one link per repo to the stars source
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.sourceId, source.id));
    expect(links).toHaveLength(3);
  });

  it('empty star list still upserts the sources row (synced-but-empty state)', async () => {
    expect(await getLastSyncedAt(db)).toBeNull();

    const result = await syncStarsToDb(db, []);
    expect(result).toMatchObject({ total: 0, synced: 0, dropped: 0 });

    expect(await getLastSyncedAt(db)).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Insert-only guard
  // -------------------------------------------------------------------------

  it('re-sync with changed metadata keeps first-write values (insert-only)', async () => {
    await syncStarsToDb(db, [makeRepo({ id: 10 })]);
    const before = await getStarsSource();

    const mutated = makeRepo({
      id: 10,
      fullName: 'alice/renamed',
      description: 'mutated description',
      language: 'Go',
      stargazersCount: 99999,
      forksCount: 1,
      topics: ['changed'],
      pushedAt: '2025-01-01T00:00:00Z',
      owner: { login: 'alice', avatarUrl: 'https://avatars.githubusercontent.com/alice-new' },
    });
    const result = await syncStarsToDb(db, [mutated]);
    expect(result.synced).toBe(1);

    const item = await getItem(10);
    expect(item.title).toBe('alice/repo-10');
    const meta = item.platformMeta as Record<string, unknown>;
    expect(meta.description).toBe('original description');
    expect(meta.language).toBe('TypeScript');
    expect(meta.stargazersCount).toBe(100);

    const author = await getAuthor('alice');
    expect(author.avatarUrl).toBe('https://avatars.githubusercontent.com/alice');

    // sources is the allowed exception: lastFetchedAt refreshed
    const after = await getStarsSource();
    expect(after.id).toBe(before.id);
    expect(after.lastFetchedAt!.getTime()).toBeGreaterThanOrEqual(before.lastFetchedAt!.getTime());
  });

  it('re-sync appends only new repos, without duplicating rows or links', async () => {
    await syncStarsToDb(db, [makeRepo({ id: 20 })]);
    await syncStarsToDb(db, [makeRepo({ id: 20 }), makeRepo({ id: 21 })]);

    const itemRows = await db
      .select()
      .from(schema.items)
      .where(eq(schema.items.platform, 'github'));
    expect(itemRows).toHaveLength(2);

    const item20 = await getItem(20);
    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, item20.id));
    expect(links).toHaveLength(1);
  });

  it('unstarred repo rows and links are retained on re-sync', async () => {
    await syncStarsToDb(db, [makeRepo({ id: 30 }), makeRepo({ id: 31 })]);

    // Repo 30 was unstarred — re-sync returns only 31.
    await syncStarsToDb(db, [makeRepo({ id: 31 })]);

    const kept = await getItem(30);
    expect(kept).toBeDefined();

    const links = await db
      .select()
      .from(schema.itemSources)
      .where(eq(schema.itemSources.itemId, kept.id));
    expect(links).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // README content pipeline (zhihu-isomorphic content channel)
  // -------------------------------------------------------------------------

  it('repo with README → chunked + item_contents markdown + charSplit chunks; without → no_content', async () => {
    const readme = '# repo-70\n\nA useful **tool**.';
    const readmeById = new Map([['70', readme]]);

    const result = await syncStarsToDb(
      db,
      [makeRepo({ id: 70 }), makeRepo({ id: 71 })],
      readmeById,
    );
    // Only the repo whose content was actually persisted feeds auto-tag/embed.
    expect(result.newItemIds).toEqual(['70']);

    const withReadme = await getItem(70);
    expect(withReadme.contentState).toBe('chunked');

    const contents = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, withReadme.id));
    expect(contents).toHaveLength(1);
    expect(contents[0].plainText).toBe(readme);

    const chunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, withReadme.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toBe(readme);
    // Embedding NOT run inline (D3) — deferred to the embed lane / 「重建向量」.
    expect(chunks[0].embedding).toBeNull();
    expect(chunks[0].startSec).toBeNull();
    expect(chunks[0].endSec).toBeNull();

    // README-less repo (404 / fetch failure degraded): no_content, zero rows.
    const withoutReadme = await getItem(71);
    expect(withoutReadme.contentState).toBe('no_content');
    const noContents = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, withoutReadme.id));
    expect(noContents).toHaveLength(0);
    const noChunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, withoutReadme.id));
    expect(noChunks).toHaveLength(0);
  });

  it('oversized README is head-truncated to MAX_README_CHARS at the persistence boundary', async () => {
    const giant = 'a'.repeat(MAX_README_CHARS + 500);
    const result = await syncStarsToDb(db, [makeRepo({ id: 80 })], new Map([['80', giant]]));
    expect(result.newItemIds).toEqual(['80']);

    const item = await getItem(80);
    const contents = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, item.id));
    expect(contents[0].plainText).toHaveLength(MAX_README_CHARS);
    expect(contents[0].plainText).toBe(giant.slice(0, MAX_README_CHARS));
  });

  it('re-sync never writes content for pre-existing repos (insert-only, empty newItemIds)', async () => {
    await syncStarsToDb(db, [makeRepo({ id: 90 })]); // first sync: no README
    const item = await getItem(90);
    expect(item.contentState).toBe('no_content');

    // A later sync offering a README for the known repo must NOT backfill.
    const second = await syncStarsToDb(
      db,
      [makeRepo({ id: 90 })],
      new Map([['90', '# late readme']]),
    );
    expect(second.newItemIds).toEqual([]);

    const after = await getItem(90);
    expect(after.contentState).toBe('no_content'); // insert-only, first-write-wins
    const contents = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, after.id));
    expect(contents).toHaveLength(0);
  });

  it('getReposNeedingReadme diffs against ingested platformItemIds (no repeat README fetch)', async () => {
    const known = [makeRepo({ id: 100 }), makeRepo({ id: 101 })];
    await syncStarsToDb(db, known);

    const resync = [...known, makeRepo({ id: 102 })];
    const fresh = await getReposNeedingReadme(db, resync);
    expect(fresh.map((r) => r.id)).toEqual([102]);

    // Empty DB → everything is new.
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    const all = await getReposNeedingReadme(db, resync);
    expect(all.map((r) => r.id)).toEqual([100, 101, 102]);
  });

  it('getReposNeedingReadme includes ghost repos (content claimed, zero chunk rows)', async () => {
    // Healthy chunked repo (has chunks) + ghost repo (claims chunked, no chunk
    // rows — a pre-fix interrupted run) + honest no_content repo.
    await syncStarsToDb(
      db,
      [makeRepo({ id: 110 }), makeRepo({ id: 111 }), makeRepo({ id: 112 })],
      new Map([['110', '# healthy readme']]),
    );
    await db
      .update(schema.items)
      .set({ contentState: 'chunked' })
      .where(and(eq(schema.items.platform, 'github'), eq(schema.items.platformItemId, '111')));
    const ghost = await getItem(111);
    await db.delete(schema.itemChunks).where(eq(schema.itemChunks.itemId, ghost.id));

    const needing = await getReposNeedingReadme(db, [
      makeRepo({ id: 110 }),
      makeRepo({ id: 111 }),
      makeRepo({ id: 112 }),
      makeRepo({ id: 113 }),
    ]);
    // Ghost (111) + brand-new (113). Healthy chunked (110) and honest
    // no_content (112) never get a second README request.
    expect(needing.map((r) => r.id)).toEqual([111, 113]);
  });

  it('re-sync heals a ghost repo: README refetched, chunks written, state truthful again', async () => {
    // First sync leaves a ghost: claims 'chunked' but its chunk rows are gone
    // (simulates the pre-fix interrupted content phase).
    await syncStarsToDb(db, [makeRepo({ id: 120 })], new Map([['120', '# original readme']]));
    const item = await getItem(120);
    await db.delete(schema.itemChunks).where(eq(schema.itemChunks.itemId, item.id));
    await db.delete(schema.itemContents).where(eq(schema.itemContents.itemId, item.id));
    expect((await getItem(120)).contentState).toBe('chunked'); // the lie

    // Next sync hands the refetched README to the ingest heal sweep.
    const result = await syncStarsToDb(
      db,
      [makeRepo({ id: 120 })],
      new Map([['120', '# refetched readme']]),
    );
    // Healed id flows into newItemIds → the embed/tag lanes pick it up.
    expect(result.newItemIds).toEqual(['120']);

    const healed = await getItem(120);
    expect(healed.contentState).toBe('chunked');
    const chunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, healed.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toBe('# refetched readme');
  });

  it('re-sync settles a ghost with no text source at no_content (honest state)', async () => {
    await syncStarsToDb(db, [makeRepo({ id: 130 })], new Map([['130', '# will vanish']]));
    const item = await getItem(130);
    await db.delete(schema.itemChunks).where(eq(schema.itemChunks.itemId, item.id));
    await db.delete(schema.itemContents).where(eq(schema.itemContents.itemId, item.id));

    // Re-sync where the README fetch failed again (no readmeById entry) —
    // no text this run, no persisted plainText → honest no_content.
    const result = await syncStarsToDb(db, [makeRepo({ id: 130 })]);
    expect(result.newItemIds).toEqual([]);
    expect((await getItem(130)).contentState).toBe('no_content');
  });

  it('re-sync heals a ghost from persisted plainText without a fresh README', async () => {
    // Ghost variant: item_contents survived but chunks are missing (the
    // pre-fix crash window between the two writes).
    await syncStarsToDb(db, [makeRepo({ id: 140 })], new Map([['140', '# persisted text']]));
    const item = await getItem(140);
    await db.delete(schema.itemChunks).where(eq(schema.itemChunks.itemId, item.id));

    const result = await syncStarsToDb(db, [makeRepo({ id: 140 })]);
    expect(result.newItemIds).toEqual(['140']);

    const healed = await getItem(140);
    expect(healed.contentState).toBe('chunked');
    const chunks = await db
      .select()
      .from(schema.itemChunks)
      .where(eq(schema.itemChunks.itemId, healed.id));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].chunkText).toBe('# persisted text');
  });

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  it('getStarredRepos orders by starredAt desc and paginates', async () => {
    await syncStarsToDb(db, [
      makeRepo({ id: 40, starredAt: '2024-01-01T00:00:00Z' }),
      makeRepo({ id: 41, starredAt: '2024-03-01T00:00:00Z' }),
      makeRepo({ id: 42, starredAt: '2024-02-01T00:00:00Z' }),
    ]);

    const page1 = await getStarredRepos({ page: 1, pageSize: 2 }, db);
    expect(page1.total).toBe(3);
    expect(page1.rows.map((r) => r.repoId)).toEqual(['41', '42']);
    // GithubRepoItem mapping sanity
    expect(page1.rows[0]).toMatchObject({
      fullName: 'alice/repo-41',
      ownerLogin: 'alice',
      htmlUrl: 'https://github.com/alice/repo-41',
      language: 'TypeScript',
      stargazersCount: 100,
      starredAt: '2024-03-01T00:00:00Z',
    });

    const page2 = await getStarredRepos({ page: 2, pageSize: 2 }, db);
    expect(page2.rows.map((r) => r.repoId)).toEqual(['40']);
  });

  it('getStarredRepos filters by language and searches title/description', async () => {
    await syncStarsToDb(db, [
      makeRepo({ id: 50, fullName: 'alice/tsproj', language: 'TypeScript' }),
      makeRepo({ id: 51, fullName: 'alice/rustproj', language: 'Rust', description: 'a fast CLI' }),
      makeRepo({ id: 52, fullName: 'alice/noname', language: null, description: null }),
    ]);

    const byLang = await getStarredRepos({ language: 'Rust', page: 1, pageSize: 10 }, db);
    expect(byLang.total).toBe(1);
    expect(byLang.rows[0].repoId).toBe('51');

    // search matches title...
    const byTitle = await getStarredRepos({ search: 'tsproj', page: 1, pageSize: 10 }, db);
    expect(byTitle.rows.map((r) => r.repoId)).toEqual(['50']);

    // ...and description (case-insensitive)
    const byDesc = await getStarredRepos({ search: 'FAST cli', page: 1, pageSize: 10 }, db);
    expect(byDesc.rows.map((r) => r.repoId)).toEqual(['51']);

    // LIKE metacharacters in input are literal, not wildcards
    const byWildcard = await getStarredRepos({ search: '%', page: 1, pageSize: 10 }, db);
    expect(byWildcard.total).toBe(0);
  });

  it('getLanguageCounts groups by language desc and excludes null', async () => {
    await syncStarsToDb(db, [
      makeRepo({ id: 60, language: 'TypeScript' }),
      makeRepo({ id: 61, language: 'TypeScript' }),
      makeRepo({ id: 62, language: 'Rust' }),
      makeRepo({ id: 63, language: null }),
    ]);

    const counts = await getLanguageCounts(db);
    expect(counts).toEqual([
      { language: 'TypeScript', count: 2 },
      { language: 'Rust', count: 1 },
    ]);
  });
});
