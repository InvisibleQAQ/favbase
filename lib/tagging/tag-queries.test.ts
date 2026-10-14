import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { getAllUsedTags, searchUsedTags } from './tag-queries';

/**
 * `searchUsedTags` is the bounded read behind the `listTags` Knowledge Tool.
 * The leaf is imported directly (no `config.ts`), so no storage mock is needed.
 */
describe('searchUsedTags (in-memory PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let seq = 0;

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
    await db.delete(schema.items);
    await db.delete(schema.authors);
  });

  async function seedItems(count: number, platform = 'bilibili'): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const n = ++seq;
      const [author] = await db
        .insert(schema.authors)
        .values({ platform, platformAuthorId: `a-${n}`, name: 'A' })
        .returning({ id: schema.authors.id });
      const [item] = await db
        .insert(schema.items)
        .values({
          platform,
          platformItemId: `item-${n}`,
          authorId: author.id,
          title: `Item ${n}`,
          authorName: 'A',
          originalUrl: `https://example.test/${platform}/${n}`,
          contentState: 'embedded',
        })
        .returning({ id: schema.items.id });
      ids.push(item.id);
    }
    return ids;
  }

  /** One tag linked to the given items; an empty list leaves it an orphan. */
  async function tag(name: string, itemIds: string[]): Promise<void> {
    const [row] = await db.insert(schema.tags).values({ name }).returning({ id: schema.tags.id });
    if (itemIds.length > 0) {
      await db.insert(schema.itemTags).values(itemIds.map((itemId) => ({ itemId, tagId: row.id })));
    }
  }

  const names = (page: { tags: { name: string }[] }) => page.tags.map((t) => t.name);

  it('cuts the page at limit and still counts every match in total', async () => {
    const items = await seedItems(3);
    await tag('three', items);
    await tag('two', items.slice(0, 2));
    await tag('one', items.slice(0, 1));
    await tag('orphan', []);

    const page = await searchUsedTags({ limit: 2 }, db);
    expect(page.tags.map((t) => ({ name: t.name, count: t.count }))).toEqual([
      { name: 'three', count: 3 },
      { name: 'two', count: 2 },
    ]);
    // Orphans stay hidden from the count too, not just from the rows.
    expect(page.total).toBe(3);
    expect(page.tags[0]).toEqual({ id: expect.any(String), name: 'three', count: 3 });

    const single = await searchUsedTags({ limit: 1 }, db);
    expect(names(single)).toEqual(['three']);
    expect(single.total).toBe(3);

    const whole = await searchUsedTags({ limit: 200 }, db);
    expect(names(whole)).toEqual(['three', 'two', 'one']);
    expect(whole.total).toBe(whole.tags.length);
  });

  it('orders ties by name, so a page cut through a tie is deterministic', async () => {
    const [item] = await seedItems(1);
    await tag('gamma', [item]);
    await tag('alpha', [item]);
    await tag('beta', [item]);

    expect(names(await searchUsedTags({ limit: 2 }, db))).toEqual(['alpha', 'beta']);
    expect(names(await searchUsedTags({ limit: 3 }, db))).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('matches a case-insensitive substring of the name, Chinese and English alike', async () => {
    const [item] = await seedItems(1);
    for (const name of ['机器学习', '深度学习', '前端', 'Rust 异步', 'rust-lang', 'TypeScript']) {
      await tag(name, [item]);
    }

    const learning = await searchUsedTags({ query: '学习', limit: 50 }, db);
    expect(names(learning).sort()).toEqual(['机器学习', '深度学习'].sort());
    expect(learning.total).toBe(2);

    const rust = await searchUsedTags({ query: 'RUST', limit: 50 }, db);
    expect(names(rust).sort()).toEqual(['Rust 异步', 'rust-lang'].sort());

    // Blank is no filter at all, not a match on whitespace.
    expect((await searchUsedTags({ query: '   ', limit: 50 }, db)).total).toBe(6);
  });

  it('matches LIKE metacharacters literally', async () => {
    const [item] = await seedItems(1);
    for (const name of ['100%完成', 'snake_case', 'back\\slash', 'plain']) {
      await tag(name, [item]);
    }

    expect(names(await searchUsedTags({ query: '%', limit: 50 }, db))).toEqual(['100%完成']);
    expect(names(await searchUsedTags({ query: '_', limit: 50 }, db))).toEqual(['snake_case']);
    expect(names(await searchUsedTags({ query: '\\', limit: 50 }, db))).toEqual(['back\\slash']);
  });

  it('combines platform and query, counting only that platform’s links', async () => {
    const bili = await seedItems(2, 'bilibili');
    const [repo] = await seedItems(1, 'github');
    await tag('rust', [...bili, repo]);
    await tag('rust-bili-only', bili);
    await tag('go', [repo]);

    const page = await searchUsedTags({ platform: 'github', query: 'rust', limit: 50 }, db);
    expect(page.tags.map((t) => ({ name: t.name, count: t.count }))).toEqual([
      { name: 'rust', count: 1 },
    ]);
    expect(page.total).toBe(1);
  });

  it('reports total 0 and no rows when nothing matches', async () => {
    const [item] = await seedItems(1);
    await tag('前端', [item]);

    expect(await searchUsedTags({ query: 'no-such-tag', limit: 50 }, db)).toEqual({ tags: [], total: 0 });
    expect(await searchUsedTags({ platform: 'github', limit: 50 }, db)).toEqual({ tags: [], total: 0 });
  });

  // Same skeleton, unbounded: the app callers still get the full list.
  it('leaves getAllUsedTags unbounded', async () => {
    const [item] = await seedItems(1);
    const rows = await db
      .insert(schema.tags)
      .values(Array.from({ length: 60 }, (_, i) => ({ name: `t${String(i).padStart(2, '0')}` })))
      .returning({ id: schema.tags.id });
    await db.insert(schema.itemTags).values(rows.map((row) => ({ itemId: item, tagId: row.id })));

    expect(await getAllUsedTags(undefined, db)).toHaveLength(60);
    const page = await searchUsedTags({ limit: 50 }, db);
    expect(page.tags).toHaveLength(50);
    expect(page.total).toBe(60);
  });
});
