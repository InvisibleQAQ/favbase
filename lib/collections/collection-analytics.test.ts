import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { vector } from '@electric-sql/pglite-pgvector';
import { drizzle } from 'drizzle-orm/pglite';

import type { FavbaseDb } from '@/lib/database';
import { runMigrations } from '@/lib/database/migrations';
import * as schema from '@/lib/database/schema';

import { getCollectionAnalytics } from './collection-analytics';

describe('getCollectionAnalytics (in-memory PGlite)', () => {
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

  afterEach(async () => {
    await db.delete(schema.itemTags);
    await db.delete(schema.tags);
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    await db.delete(schema.sources);
    await db.delete(schema.authors);
  });

  async function seedItem(input: {
    platform: string;
    platformItemId: string;
    authorId: string;
    authorName: string;
    language?: unknown;
  }) {
    const rows = await db
      .insert(schema.items)
      .values({
        platform: input.platform,
        platformItemId: input.platformItemId,
        authorId: input.authorId,
        authorName: input.authorName,
        title: input.platformItemId,
        originalUrl: `https://example.test/${input.platformItemId}`,
        contentState: 'no_content',
        platformMeta: input.language === undefined ? {} : { language: input.language },
      })
      .returning({ id: schema.items.id });
    return rows[0].id;
  }

  it('returns a fixed six-platform zero snapshot', async () => {
    const snapshot = await getCollectionAnalytics(db);

    expect(snapshot).toMatchObject({ totalItems: 0, usedTags: 0, taggedItems: 0 });
    expect(snapshot.platforms.map(({ platform, itemCount, share }) => ({ platform, itemCount, share })))
      .toEqual([
        { platform: 'bilibili', itemCount: 0, share: 0 },
        { platform: 'github', itemCount: 0, share: 0 },
        { platform: 'bookmarks', itemCount: 0, share: 0 },
        { platform: 'x', itemCount: 0, share: 0 },
        { platform: 'zhihu', itemCount: 0, share: 0 },
        { platform: 'youtube', itemCount: 0, share: 0 },
      ]);
    expect(snapshot.topTags).toEqual([]);
  });

  it('keeps item totals deduplicated while ranking native memberships and tags', async () => {
    const authors = await db
      .insert(schema.authors)
      .values([
        { platform: 'bilibili', platformAuthorId: 'u1', name: 'Alice' },
        { platform: 'github', platformAuthorId: 'g1', name: 'octocat' },
        { platform: 'bookmarks', platformAuthorId: 'd1', name: 'example.com' },
        { platform: 'mystery', platformAuthorId: 'm1', name: 'Unknown' },
      ])
      .returning({ id: schema.authors.id, platform: schema.authors.platform });
    const author = (platform: string) => authors.find((row) => row.platform === platform)!.id;

    const biliId = await seedItem({
      platform: 'bilibili',
      platformItemId: 'bv1',
      authorId: author('bilibili'),
      authorName: 'Alice',
    });
    const githubOne = await seedItem({
      platform: 'github',
      platformItemId: 'repo-1',
      authorId: author('github'),
      authorName: 'octocat',
      language: 'TypeScript',
    });
    await seedItem({
      platform: 'github',
      platformItemId: 'repo-2',
      authorId: author('github'),
      authorName: 'octocat',
      language: 'TypeScript',
    });
    await seedItem({
      platform: 'bookmarks',
      platformItemId: 'bookmark-1',
      authorId: author('bookmarks'),
      authorName: 'example.com',
    });
    const unknownId = await seedItem({
      platform: 'mystery',
      platformItemId: 'ignored',
      authorId: author('mystery'),
      authorName: 'Unknown',
    });

    const sources = await db
      .insert(schema.sources)
      .values([
        { platform: 'bilibili', platformSourceId: 'folder-a', title: 'Folder A' },
        { platform: 'bilibili', platformSourceId: 'folder-b', title: 'Folder B' },
      ])
      .returning({ id: schema.sources.id });
    await db.insert(schema.itemSources).values(
      sources.map((source) => ({ itemId: biliId, sourceId: source.id })),
    );

    const tagRows = await db
      .insert(schema.tags)
      .values([
        { name: 'frontend' },
        { name: 'saved' },
        { name: 'orphan' },
        { name: 'unknown-only' },
      ])
      .returning({ id: schema.tags.id, name: schema.tags.name });
    const tag = (name: string) => tagRows.find((row) => row.name === name)!.id;
    await db.insert(schema.itemTags).values([
      { itemId: biliId, tagId: tag('frontend') },
      { itemId: githubOne, tagId: tag('frontend') },
      { itemId: githubOne, tagId: tag('saved') },
      { itemId: unknownId, tagId: tag('unknown-only') },
    ]);

    const snapshot = await getCollectionAnalytics(db);

    expect(snapshot.totalItems).toBe(4);
    expect(snapshot.usedTags).toBe(2);
    expect(snapshot.taggedItems).toBe(2);
    expect(snapshot.topTags.map(({ name, itemCount }) => ({ name, itemCount }))).toEqual([
      { name: 'frontend', itemCount: 2 },
      { name: 'saved', itemCount: 1 },
    ]);
    expect(snapshot.platforms.find((row) => row.platform === 'github')).toMatchObject({
      itemCount: 2,
      share: 0.5,
      dimensions: [
        { kind: 'language', entries: [{ id: 'TypeScript', label: 'TypeScript', itemCount: 2 }] },
        { kind: 'repositoryOwner', entries: [{ id: expect.any(String), label: 'octocat', itemCount: 2 }] },
      ],
    });
    expect(snapshot.platforms.find((row) => row.platform === 'bilibili')).toMatchObject({
      itemCount: 1,
      share: 0.25,
      dimensions: [
        { kind: 'uploader', entries: [{ id: expect.any(String), label: 'Alice', itemCount: 1 }] },
        {
          kind: 'favoriteFolder',
          entries: [
            { id: expect.any(String), label: 'Folder A', itemCount: 1 },
            { id: expect.any(String), label: 'Folder B', itemCount: 1 },
          ],
        },
      ],
    });
  });

  it('ignores malformed GitHub language metadata instead of inventing dimensions', async () => {
    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'github', platformAuthorId: 'owner', name: 'Owner' })
      .returning({ id: schema.authors.id });
    const languages: unknown[] = ['TypeScript', ['Rust'], { name: 'Go' }, '   ', null];

    for (const [index, language] of languages.entries()) {
      await seedItem({
        platform: 'github',
        platformItemId: `repo-language-${index}`,
        authorId: author.id,
        authorName: 'Owner',
        language,
      });
    }

    const snapshot = await getCollectionAnalytics(db);
    const github = snapshot.platforms.find((row) => row.platform === 'github')!;

    expect(github.dimensions.find((dimension) => dimension.kind === 'language')?.entries).toEqual([
      { id: 'TypeScript', label: 'TypeScript', itemCount: 1 },
    ]);
  });

  it('keeps top-tag ties stable and bounded', async () => {
    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'x', platformAuthorId: 'author', name: 'Author' })
      .returning({ id: schema.authors.id });
    const itemId = await seedItem({
      platform: 'x',
      platformItemId: 'tagged-post',
      authorId: author.id,
      authorName: 'Author',
    });
    const tagRows = await db
      .insert(schema.tags)
      .values(
        Array.from({ length: 10 }, (_, index) => ({
          name: `tag-${String(index).padStart(2, '0')}`,
        })),
      )
      .returning({ id: schema.tags.id });
    await db.insert(schema.itemTags).values(tagRows.map((tag) => ({ itemId, tagId: tag.id })));

    const snapshot = await getCollectionAnalytics(db);

    expect(snapshot.topTags.map((tag) => tag.name)).toEqual(
      Array.from({ length: 8 }, (_, index) => `tag-${String(index).padStart(2, '0')}`),
    );
  });

  it('maps every remaining native dimension and keeps tied rankings stable and bounded', async () => {
    const authorInputs = [
      { platform: 'bookmarks', platformAuthorId: 'example.com', name: 'example.com' },
      { platform: 'zhihu', platformAuthorId: 'zhihu-a', name: 'Zhihu Author' },
      { platform: 'youtube', platformAuthorId: 'channel-a', name: 'Channel A' },
      ...Array.from({ length: 10 }, (_, index) => ({
        platform: 'x',
        platformAuthorId: `x-${index}`,
        name: `Author ${String(index).padStart(2, '0')}`,
      })),
    ];
    const authorRows = await db
      .insert(schema.authors)
      .values(authorInputs)
      .returning({
        id: schema.authors.id,
        platform: schema.authors.platform,
        platformAuthorId: schema.authors.platformAuthorId,
      });
    const authorId = (platform: string, platformAuthorId: string) =>
      authorRows.find(
        (row) => row.platform === platform && row.platformAuthorId === platformAuthorId,
      )!.id;

    const bookmarkId = await seedItem({
      platform: 'bookmarks',
      platformItemId: 'bookmark-native',
      authorId: authorId('bookmarks', 'example.com'),
      authorName: 'example.com',
    });
    const zhihuId = await seedItem({
      platform: 'zhihu',
      platformItemId: 'zhihu-native',
      authorId: authorId('zhihu', 'zhihu-a'),
      authorName: 'Zhihu Author',
    });
    const youtubeId = await seedItem({
      platform: 'youtube',
      platformItemId: 'youtube-native',
      authorId: authorId('youtube', 'channel-a'),
      authorName: 'Channel A',
    });
    for (let index = 0; index < 10; index += 1) {
      await seedItem({
        platform: 'x',
        platformItemId: `tweet-${index}`,
        authorId: authorId('x', `x-${index}`),
        authorName: `Author ${String(index).padStart(2, '0')}`,
      });
    }

    const sourceRows = await db
      .insert(schema.sources)
      .values([
        { platform: 'bookmarks', platformSourceId: 'folder', title: 'Reading' },
        { platform: 'zhihu', platformSourceId: 'collection', title: 'Engineering' },
        { platform: 'youtube', platformSourceId: 'playlist', title: 'Watch later' },
      ])
      .returning({ id: schema.sources.id, platform: schema.sources.platform });
    const sourceId = (platform: string) =>
      sourceRows.find((source) => source.platform === platform)!.id;
    await db.insert(schema.itemSources).values([
      { itemId: bookmarkId, sourceId: sourceId('bookmarks') },
      { itemId: zhihuId, sourceId: sourceId('zhihu') },
      { itemId: youtubeId, sourceId: sourceId('youtube') },
    ]);

    const snapshot = await getCollectionAnalytics(db);
    const dimensions = (platform: string) =>
      snapshot.platforms.find((row) => row.platform === platform)!.dimensions;

    expect(dimensions('bookmarks')).toMatchObject([
      { kind: 'domain', entries: [{ label: 'example.com', itemCount: 1 }] },
      { kind: 'folder', entries: [{ label: 'Reading', itemCount: 1 }] },
    ]);
    expect(dimensions('zhihu')).toMatchObject([
      { kind: 'author', entries: [{ label: 'Zhihu Author', itemCount: 1 }] },
      { kind: 'collection', entries: [{ label: 'Engineering', itemCount: 1 }] },
    ]);
    expect(dimensions('youtube')).toMatchObject([
      { kind: 'channel', entries: [{ label: 'Channel A', itemCount: 1 }] },
      { kind: 'playlist', entries: [{ label: 'Watch later', itemCount: 1 }] },
    ]);
    expect(dimensions('x')).toMatchObject([
      {
        kind: 'author',
        entries: Array.from({ length: 8 }, (_, index) => ({
          label: `Author ${String(index).padStart(2, '0')}`,
          itemCount: 1,
        })),
      },
    ]);
  });
});
