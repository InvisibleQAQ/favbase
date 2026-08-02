import { describe, it, expect, beforeAll, afterAll, afterEach, vi, type Mock } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { onDomainEvent } from '@/lib/events';
import type { ResolvedTaggingConfig } from './config';
import type { TaggingInput } from './prompt';
import {
  tagPlatformItem,
  tagPlatformBacklog,
  tagNewItems,
  getAllUsedTags,
  getTagsForPlatformItems,
  getItemsByTags,
  addTagToPlatformItem,
  removeTagFromPlatformItem,
} from './tagging-service';

// config.ts (pulled in by tagging-service.ts) value-imports `settingsStorage`,
// whose barrel eagerly touches chrome.runtime at load. All tests inject
// explicit deps, so the stubs are never actually called.
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const enabledConfig: ResolvedTaggingConfig = {
  providerId: 'modelscope',
  apiKey: 'k',
  model: 'm',
  customBaseUrl: '',
  customProtocol: 'openai',
  enabled: true,
};

const disabledConfig: ResolvedTaggingConfig = { ...enabledConfig, apiKey: '', enabled: false };

type GenerateFn = (
  config: ResolvedTaggingConfig,
  input: TaggingInput,
  existingTags: string[],
) => Promise<string[]>;

function makeGenerate(names: string[] = ['前端', 'React']) {
  return vi.fn<GenerateFn>(async () => names);
}

describe('tagging-service (in-memory PGlite)', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let authorSeq = 0;

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
    await db.delete(schema.itemTags);
    await db.delete(schema.tags);
    await db.delete(schema.itemContents);
    await db.delete(schema.items);
    await db.delete(schema.authors);
  });

  async function seedItem(platformItemId: string, platform = 'bilibili'): Promise<string> {
    const authorRows = await db
      .insert(schema.authors)
      .values({ platform, platformAuthorId: `mid-${++authorSeq}`, name: 'Alice' })
      .returning({ id: schema.authors.id });

    const itemRows = await db
      .insert(schema.items)
      .values({
        platform,
        platformItemId,
        authorId: authorRows[0].id,
        title: `Title of ${platformItemId}`,
        authorName: 'Alice',
        originalUrl: `https://example.test/${platform}/${platformItemId}`,
        contentState: 'embedded',
        platformMeta: { intro: 'intro text' },
      })
      .returning({ id: schema.items.id });
    return itemRows[0].id;
  }

  function deps(overrides?: {
    getConfig?: () => Promise<ResolvedTaggingConfig>;
    generate?: Mock<GenerateFn>;
  }) {
    return {
      db: () => db,
      getConfig: async () => enabledConfig,
      generate: makeGenerate(),
      ...overrides,
    };
  }

  // -------------------------------------------------------------------------
  // tagPlatformItem
  // -------------------------------------------------------------------------

  describe('tagPlatformItem', () => {
    it('tags an item: creates tag rows and links (happy path)', async () => {
      const itemId = await seedItem('BV1HAPPY');

      const result = await tagPlatformItem('bilibili', 'BV1HAPPY', deps());
      expect(result).toBe('tagged');

      const tagRows = await db.select().from(schema.tags);
      expect(tagRows.map((t) => t.name).sort()).toEqual(['React', '前端']);

      const links = await db
        .select()
        .from(schema.itemTags)
        .where(eq(schema.itemTags.itemId, itemId));
      expect(links).toHaveLength(2);
    });

    it('reuses an existing same-name tag row instead of duplicating', async () => {
      const existing = await db
        .insert(schema.tags)
        .values({ name: '前端' })
        .returning({ id: schema.tags.id });
      const itemId = await seedItem('BV2REUSE');

      await tagPlatformItem('bilibili', 'BV2REUSE', deps());

      const frontendRows = await db
        .select()
        .from(schema.tags)
        .where(eq(schema.tags.name, '前端'));
      expect(frontendRows).toHaveLength(1);
      expect(frontendRows[0].id).toBe(existing[0].id);

      const links = await db
        .select()
        .from(schema.itemTags)
        .where(eq(schema.itemTags.itemId, itemId));
      expect(links.map((l) => l.tagId)).toContain(existing[0].id);
    });

    it('is idempotent: an already-tagged item is skipped without a second LLM call', async () => {
      await seedItem('BV3IDEM');
      const d = deps();

      expect(await tagPlatformItem('bilibili', 'BV3IDEM', d)).toBe('tagged');
      expect(await tagPlatformItem('bilibili', 'BV3IDEM', d)).toBe('skipped');
      expect(d.generate).toHaveBeenCalledTimes(1);
    });

    it('skips silently when tagging is not configured (no LLM call, no rows)', async () => {
      await seedItem('BV4NOCFG');
      const d = deps({ getConfig: async () => disabledConfig });

      expect(await tagPlatformItem('bilibili', 'BV4NOCFG', d)).toBe('skipped');
      expect(d.generate).not.toHaveBeenCalled();
      expect(await db.select().from(schema.tags)).toHaveLength(0);
      expect(await db.select().from(schema.itemTags)).toHaveLength(0);
    });

    it('skips when the item does not exist', async () => {
      const d = deps();
      expect(await tagPlatformItem('bilibili', 'BV5MISSING', d)).toBe('skipped');
      expect(d.generate).not.toHaveBeenCalled();
    });

    it('returns failed and leaves no rows when the LLM call throws', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await seedItem('BV6FAIL');
      const d = deps({
        generate: vi.fn<GenerateFn>(async () => {
          throw new Error('LLM boom');
        }),
      });

      expect(await tagPlatformItem('bilibili', 'BV6FAIL', d)).toBe('failed');
      expect(await db.select().from(schema.tags)).toHaveLength(0);
      expect(await db.select().from(schema.itemTags)).toHaveLength(0);
      expect(errSpy).toHaveBeenCalled();
      errSpy.mockRestore();
    });

    it('feeds already-used tag names into the LLM as existing tags', async () => {
      await seedItem('BV7SEEDED');
      await tagPlatformItem('bilibili', 'BV7SEEDED', deps({ generate: makeGenerate(['算法']) }));

      await seedItem('BV7TARGET');
      const d = deps();
      await tagPlatformItem('bilibili', 'BV7TARGET', d);

      const existingArg = d.generate.mock.calls[0][2];
      expect(existingArg).toContain('算法');
    });

    it('passes the transcript plainText as input.content, plus title/author/intro', async () => {
      const itemId = await seedItem('BV8CONTENT');
      await db.insert(schema.itemContents).values({ itemId, plainText: '转录内容...' });

      const d = deps();
      await tagPlatformItem('bilibili', 'BV8CONTENT', d);

      const input = d.generate.mock.calls[0][1];
      expect(input.content).toBe('转录内容...');
      expect(input.title).toBe('Title of BV8CONTENT');
      expect(input.author).toBe('Alice');
      expect(input.description).toBe('intro text');
    });

    it('passes undefined content when the item has no transcript row', async () => {
      await seedItem('BV8NOCONTENT');
      const d = deps();
      await tagPlatformItem('bilibili', 'BV8NOCONTENT', d);

      expect(d.generate.mock.calls[0][1].content).toBeUndefined();
    });

    it("emits 'item-tagged' once on success; the idempotent skip does not re-emit", async () => {
      await seedItem('BV14EVENT');
      const events: Array<{ platform: string; platformItemId: string }> = [];
      const off = onDomainEvent('item-tagged', (e) => events.push(e));
      try {
        await tagPlatformItem('bilibili', 'BV14EVENT', deps());
        expect(events).toEqual([{ platform: 'bilibili', platformItemId: 'BV14EVENT' }]);

        await tagPlatformItem('bilibili', 'BV14EVENT', deps());
        expect(events).toHaveLength(1);
      } finally {
        off();
      }
    });

    it("does not emit 'item-tagged' on skip (unconfigured) or failure", async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const listener = vi.fn();
      const off = onDomainEvent('item-tagged', listener);
      try {
        await seedItem('BV15NOEVENT');
        await tagPlatformItem('bilibili', 'BV15NOEVENT', deps({ getConfig: async () => disabledConfig }));

        await tagPlatformItem(
          'bilibili',
          'BV15NOEVENT',
          deps({
            generate: vi.fn<GenerateFn>(async () => {
              throw new Error('LLM boom');
            }),
          }),
        );

        expect(listener).not.toHaveBeenCalled();
      } finally {
        off();
        errSpy.mockRestore();
      }
    });
  });

  // -------------------------------------------------------------------------
  // tagNewItems (batch entry for collection syncs — audit docs/16 MEDIUM-2)
  // -------------------------------------------------------------------------

  describe('tagNewItems', () => {
    it('tags every item in the batch, one LLM call per item', async () => {
      await seedItem('t1', 'x');
      await seedItem('t2', 'x');
      const generate = makeGenerate(['技术']);

      await tagNewItems('x', ['t1', 't2'], deps({ generate }));

      expect(generate).toHaveBeenCalledTimes(2);
      const tagsById = await getTagsForPlatformItems('x', ['t1', 't2'], db);
      expect(tagsById.t1?.map((t) => t.name)).toEqual(['技术']);
      expect(tagsById.t2?.map((t) => t.name)).toEqual(['技术']);
    });

    it('empty batch is a no-op (no config read, no LLM call)', async () => {
      const getConfig = vi.fn(async () => enabledConfig);
      const generate = makeGenerate();

      await tagNewItems('x', [], deps({ getConfig, generate }));

      expect(getConfig).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
    });

    it('one failing item never aborts the rest (tagPlatformItem never-throws)', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await seedItem('t3', 'x');
        await seedItem('t4', 'x');
        const generate = vi.fn<GenerateFn>(async (_config, input) => {
          if (input.title.includes('t3')) throw new Error('LLM boom');
          return ['技术'];
        });

        await expect(tagNewItems('x', ['t3', 't4'], deps({ generate }))).resolves.toBeUndefined();

        const tagsById = await getTagsForPlatformItems('x', ['t3', 't4'], db);
        expect(tagsById.t3).toBeUndefined();
        expect(tagsById.t4?.map((t) => t.name)).toEqual(['技术']);
      } finally {
        errSpy.mockRestore();
      }
    });

    it('reports onProgress 0/total up front then increments to total (ids.length)', async () => {
      await seedItem('tp1', 'x');
      await seedItem('tp2', 'x');
      const onProgress = vi.fn();

      await tagNewItems('x', ['tp1', 'tp2'], deps(), onProgress);

      // total = input count; 0-based start, monotonic to 2/2.
      expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
    });

    it('advances onProgress for a skipped item too (total = ids.length)', async () => {
      // tp3 exists → tagged; tp4 is missing → tagPlatformItem returns 'skipped'
      // but progress still advances for it.
      await seedItem('tp3', 'x');
      const onProgress = vi.fn();

      await tagNewItems('x', ['tp3', 'tp4-missing'], deps(), onProgress);

      expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
    });

    it('checks cooperative control before claiming each item', async () => {
      await seedItem('tc1', 'x');
      await seedItem('tc2', 'x');
      const checkpoint = vi.fn(async () => {});

      await tagNewItems('x', ['tc1', 'tc2'], deps(), undefined, { checkpoint });

      expect(checkpoint).toHaveBeenCalledTimes(2);
    });
  });

  describe('tagPlatformBacklog', () => {
    it('reports an empty run without opening the DB when LLM configuration is disabled', async () => {
      const dbAccess = vi.fn(() => {
        throw new Error('DB should not be opened');
      });
      const onProgress = vi.fn();

      await tagPlatformBacklog(
        'x',
        {
          db: dbAccess,
          getConfig: async () => disabledConfig,
          generate: makeGenerate(),
        },
        onProgress,
      );

      expect(dbAccess).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith({ done: 0, total: 0 });
    });

    it('tags only untagged chunked or embedded items from the requested platform', async () => {
      await seedItem('x-embedded', 'x');
      const chunkedId = await seedItem('x-chunked', 'x');
      await db
        .update(schema.items)
        .set({ contentState: 'chunked' })
        .where(eq(schema.items.id, chunkedId));
      for (const contentState of ['pending', 'has_content', 'no_content', 'error'] as const) {
        const excludedId = await seedItem(`x-${contentState}`, 'x');
        await db
          .update(schema.items)
          .set({ contentState })
          .where(eq(schema.items.id, excludedId));
      }
      await seedItem('github-ready', 'github');
      await seedItem('x-tagged', 'x');
      await addTagToPlatformItem('x', 'x-tagged', 'existing', db);
      const generate = makeGenerate(['backlog']);
      const onProgress = vi.fn();

      await tagPlatformBacklog('x', deps({ generate }), onProgress);

      expect(generate).toHaveBeenCalledTimes(2);
      expect(generate.mock.calls.map((call) => call[1].title).sort()).toEqual([
        'Title of x-chunked',
        'Title of x-embedded',
      ]);
      expect(onProgress.mock.calls.map((call) => call[0])).toEqual([
        { done: 0, total: 2 },
        { done: 1, total: 2 },
        { done: 2, total: 2 },
      ]);
    });

    it('shares the Bilibili downstream eligibility rule with Processing Coverage', async () => {
      await seedItem('BV-VALID');
      const invalidId = await seedItem('BV-INVALID');
      await db
        .update(schema.items)
        .set({ platformMeta: { attr: 9 } })
        .where(eq(schema.items.id, invalidId));
      const generate = makeGenerate(['eligible']);

      await tagPlatformBacklog('bilibili', deps({ generate }));

      expect(generate).toHaveBeenCalledTimes(1);
      expect(generate.mock.calls[0][1].title).toBe('Title of BV-VALID');
    });

    it('is idempotent across backlog reruns', async () => {
      await seedItem('x-idempotent', 'x');
      const generate = makeGenerate(['once']);
      const secondProgress = vi.fn();

      await tagPlatformBacklog('x', deps({ generate }));
      await tagPlatformBacklog('x', deps({ generate }), secondProgress);

      expect(generate).toHaveBeenCalledTimes(1);
      expect(secondProgress).toHaveBeenCalledWith({ done: 0, total: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // getAllUsedTags
  // -------------------------------------------------------------------------

  describe('getAllUsedTags', () => {
    it('returns tags most-used first and hides orphan tags', async () => {
      await seedItem('BV9A');
      await seedItem('BV9B');
      await tagPlatformItem('bilibili', 'BV9A', deps({ generate: makeGenerate(['共享', '独占']) }));
      await tagPlatformItem('bilibili', 'BV9B', deps({ generate: makeGenerate(['共享']) }));

      const used = await getAllUsedTags(undefined, db);
      expect(used.map((t) => ({ name: t.name, count: t.count }))).toEqual([
        { name: '共享', count: 2 },
        { name: '独占', count: 1 },
      ]);

      // Remove every link of 独占 — it must vanish from the used list (orphan).
      const soloTag = used.find((t) => t.name === '独占')!;
      await db.delete(schema.itemTags).where(eq(schema.itemTags.tagId, soloTag.id));

      const after = await getAllUsedTags(undefined, db);
      expect(after.map((t) => t.name)).toEqual(['共享']);
      // Tag row itself survives — only the used list hides it.
      expect(await db.select().from(schema.tags).where(eq(schema.tags.id, soloTag.id))).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // getItemsByTags (AND semantics)
  // -------------------------------------------------------------------------

  describe('getItemsByTags', () => {
    it('narrows with AND semantics and returns complete tags per item', async () => {
      await seedItem('BV10BOTH');
      await seedItem('BV10ONE');
      await tagPlatformItem('bilibili', 'BV10BOTH', deps({ generate: makeGenerate(['a', 'b']) }));
      await tagPlatformItem('bilibili', 'BV10ONE', deps({ generate: makeGenerate(['a']) }));

      const used = await getAllUsedTags(undefined, db);
      const tagA = used.find((t) => t.name === 'a')!;
      const tagB = used.find((t) => t.name === 'b')!;

      const byA = await getItemsByTags([tagA.id], undefined, db);
      expect(byA.map((i) => i.platformItemId).sort()).toEqual(['BV10BOTH', 'BV10ONE']);

      const byAB = await getItemsByTags([tagA.id, tagB.id], undefined, db);
      expect(byAB.map((i) => i.platformItemId)).toEqual(['BV10BOTH']);
      // tags field carries ALL tags of the item, name-sorted.
      expect(byAB[0].tags.map((t) => t.name)).toEqual(['a', 'b']);
      expect(byAB[0].title).toBe('Title of BV10BOTH');
      expect(byAB[0].platform).toBe('bilibili');
      // originalUrl rides along so card adapters can link out directly.
      expect(byAB[0].originalUrl).toBe('https://example.test/bilibili/BV10BOTH');

      expect(await getItemsByTags([], undefined, db)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Platform filtering (page-scoped tag chips / grids)
  // -------------------------------------------------------------------------

  describe('platform filtering', () => {
    async function seedTwoPlatforms() {
      await seedItem('BVPLAT');
      await seedItem('987654', 'github');
      await addTagToPlatformItem('bilibili', 'BVPLAT', '共享', db);
      await addTagToPlatformItem('github', '987654', '共享', db);
      await addTagToPlatformItem('github', '987654', '仓库', db);
    }

    it('getAllUsedTags scopes tags and counts to the given platform', async () => {
      await seedTwoPlatforms();

      // No platform → whole library.
      const all = await getAllUsedTags(undefined, db);
      expect(all.map((t) => ({ name: t.name, count: t.count }))).toEqual([
        { name: '共享', count: 2 },
        { name: '仓库', count: 1 },
      ]);

      // bilibili → shared tag counts only bilibili links; github-only tag hidden.
      const bili = await getAllUsedTags('bilibili', db);
      expect(bili.map((t) => ({ name: t.name, count: t.count }))).toEqual([
        { name: '共享', count: 1 },
      ]);

      const gh = await getAllUsedTags('github', db);
      expect(gh.map((t) => ({ name: t.name, count: t.count }))).toEqual([
        { name: '仓库', count: 1 },
        { name: '共享', count: 1 },
      ]);

      const registered = await getAllUsedTags(['bilibili', 'github'], db);
      expect(registered.map((t) => ({ name: t.name, count: t.count }))).toEqual([
        { name: '共享', count: 2 },
        { name: '仓库', count: 1 },
      ]);
    });

    it('getItemsByTags returns only the given platform’s items', async () => {
      await seedTwoPlatforms();
      const shared = (await getAllUsedTags(undefined, db)).find((t) => t.name === '共享')!;

      const all = await getItemsByTags([shared.id], undefined, db);
      expect(all.map((i) => i.platformItemId).sort()).toEqual(['987654', 'BVPLAT']);

      const bili = await getItemsByTags([shared.id], 'bilibili', db);
      expect(bili.map((i) => i.platformItemId)).toEqual(['BVPLAT']);

      const gh = await getItemsByTags([shared.id], 'github', db);
      expect(gh.map((i) => i.platformItemId)).toEqual(['987654']);
      expect(gh[0].originalUrl).toBe('https://example.test/github/987654');
    });
  });

  // -------------------------------------------------------------------------
  // getTagsForPlatformItems
  // -------------------------------------------------------------------------

  describe('getTagsForPlatformItems', () => {
    it('maps platformItemId → name-sorted tags, omitting untagged items', async () => {
      await seedItem('BV11TAGGED');
      await seedItem('BV11BARE');
      await tagPlatformItem('bilibili', 'BV11TAGGED', deps({ generate: makeGenerate(['b', 'a']) }));

      const map = await getTagsForPlatformItems('bilibili', ['BV11TAGGED', 'BV11BARE'], db);
      expect(Object.keys(map)).toEqual(['BV11TAGGED']);
      expect(map.BV11TAGGED.map((t) => t.name)).toEqual(['a', 'b']);

      expect(await getTagsForPlatformItems('bilibili', [], db)).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // Manual edit round trip
  // -------------------------------------------------------------------------

  describe('addTagToPlatformItem / removeTagFromPlatformItem', () => {
    it('creates a tag on first use, reuses it by name, rejects blanks/unknown items', async () => {
      await seedItem('BV12EDIT');

      const created = await addTagToPlatformItem('bilibili', 'BV12EDIT', ' 新标签 ', db);
      expect(created).toMatchObject({ name: '新标签' });

      await seedItem('BV12OTHER');
      const reused = await addTagToPlatformItem('bilibili', 'BV12OTHER', '新标签', db);
      expect(reused?.id).toBe(created?.id);

      expect(await addTagToPlatformItem('bilibili', 'BV12EDIT', '   ', db)).toBeNull();
      expect(await addTagToPlatformItem('bilibili', 'BVUNKNOWN', 'x', db)).toBeNull();
    });

    it('removing the last link makes the tag disappear from getAllUsedTags', async () => {
      await seedItem('BV13RM');
      const ref = await addTagToPlatformItem('bilibili', 'BV13RM', '临时', db);
      expect((await getAllUsedTags(undefined, db)).map((t) => t.name)).toContain('临时');

      await removeTagFromPlatformItem('bilibili', 'BV13RM', ref!.id, db);
      expect((await getAllUsedTags(undefined, db)).map((t) => t.name)).not.toContain('临时');

      // Unknown item is a silent no-op.
      await removeTagFromPlatformItem('bilibili', 'BVUNKNOWN', ref!.id, db);
    });
  });
});
