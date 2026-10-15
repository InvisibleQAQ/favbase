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
import { TaggingSpendError, type GeneratedTags } from './tagger';
import type { TaggingBudget } from './budget';
import {
  tagPlatformItem,
  tagPlatformBacklog,
  tagNewItems,
  getAllUsedTags,
  getTagsForPlatformItems,
  getItemsByTags,
  addTagToPlatformItem,
  removeTagFromPlatformItem,
  type TaggingDeps,
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
) => Promise<GeneratedTags>;

function makeGenerate(names: string[] = ['前端', 'React'], tokens = 100) {
  return vi.fn<GenerateFn>(async () => ({ tags: names, tokens }));
}

/**
 * A Tagging Budget fake with a cap and a running total, so tests read what was
 * charged instead of how often `charge` was called. `steps` records the order
 * of budget calls for the check-before / charge-after assertions.
 */
function fakeBudget(cap = Number.POSITIVE_INFINITY) {
  const state = { spent: 0, steps: [] as string[] };
  const budget = {
    remaining: vi.fn<TaggingBudget['remaining']>(async () => {
      state.steps.push('remaining');
      return cap - state.spent;
    }),
    charge: vi.fn<TaggingBudget['charge']>(async (tokens) => {
      state.steps.push(`charge:${tokens}`);
      state.spent += tokens;
    }),
  };
  return Object.assign(state, { budget });
}

/** The item claim as an uncontended tab sees it: always granted. */
const grantedClaim: TaggingDeps['claim'] = (_key, run) => run();

/** A claim another app.html tab is holding. */
const heldElsewhere: TaggingDeps['claim'] = async () => null;

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

  async function seedItem(
    platformItemId: string,
    platform = 'bilibili',
    platformMeta: Record<string, unknown> = { intro: 'intro text' },
  ): Promise<string> {
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
        platformMeta,
      })
      .returning({ id: schema.items.id });
    return itemRows[0].id;
  }

  function deps(overrides?: {
    getConfig?: () => Promise<ResolvedTaggingConfig>;
    generate?: Mock<GenerateFn>;
    budget?: TaggingBudget;
    claim?: TaggingDeps['claim'];
    db?: () => FavbaseDb;
  }) {
    return {
      db: () => db,
      getConfig: async () => enabledConfig,
      generate: makeGenerate(),
      budget: fakeBudget().budget,
      claim: grantedClaim,
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

    it('skips an Item rejected by the shared processing policy', async () => {
      const itemId = await seedItem('BV-POLICY-INVALID');
      await db
        .update(schema.items)
        .set({ platformMeta: { attr: 9 } })
        .where(eq(schema.items.id, itemId));
      const d = deps();

      expect(await tagPlatformItem('bilibili', 'BV-POLICY-INVALID', d)).toBe('skipped');
      expect(d.generate).not.toHaveBeenCalled();
      expect(await db.select().from(schema.itemTags)).toHaveLength(0);
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

    it("feeds a GitHub repository's description as input.description, even without a README", async () => {
      // docs/32 中-4: the prompt used to read Bilibili's `intro` only, so a
      // star with no README reached the LLM as a bare title and owner.
      await seedItem('gh-no-readme', 'github', { description: 'A CLI for …', language: 'Rust' });
      const d = deps();
      await tagPlatformItem('github', 'gh-no-readme', d);

      const input = d.generate.mock.calls[0][1];
      expect(input.description).toBe('A CLI for …');
      expect(input.content).toBeUndefined();
    });

    it("feeds a Douyin post's desc as input.description next to the transcript", async () => {
      // Pins douyin's `descriptionField: 'desc'` (docs/37 D1): a video's
      // Content is its transcript, so the post text is the description the
      // Content does not already carry.
      await seedItem('dy-1', 'douyin', { desc: '文案 #tag', mediaKind: 'video' });
      const d = deps();
      await tagPlatformItem('douyin', 'dy-1', d);

      expect(d.generate.mock.calls[0][1].description).toBe('文案 #tag');
    });

    it('ignores YouTube meta description: the full text is already the Content', async () => {
      // Pins youtube's `descriptionField: null`. Its meta `description` is a
      // card-sized slice of the text the Content already carries.
      await seedItem('yt-video', 'youtube', { description: 'truncated card snippet' });
      const d = deps();
      await tagPlatformItem('youtube', 'yt-video', d);

      expect(d.generate.mock.calls[0][1].description).toBeUndefined();
    });

    it.each([
      ['an empty string', ''],
      ['a non-string', 42],
    ])('passes undefined description when the GitHub description is %s', async (_, value) => {
      await seedItem('gh-bad-description', 'github', { description: value });
      const d = deps();
      await tagPlatformItem('github', 'gh-bad-description', d);

      expect(d.generate.mock.calls[0][1].description).toBeUndefined();
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
  // Tagging Budget (docs/41): checked and charged only inside tagPlatformItem
  // -------------------------------------------------------------------------

  describe('Tagging Budget', () => {
    it('defers a spent day without calling the LLM, charging, or writing rows', async () => {
      await seedItem('BV-SPENT');
      const spent = fakeBudget(0);
      const d = deps({ budget: spent.budget });

      expect(await tagPlatformItem('bilibili', 'BV-SPENT', d)).toBe('deferred');
      expect(d.generate).not.toHaveBeenCalled();
      expect(spent.budget.charge).not.toHaveBeenCalled();
      expect(await db.select().from(schema.tags)).toHaveLength(0);
      expect(await db.select().from(schema.itemTags)).toHaveLength(0);
    });

    it('checks before the call and charges the reported spend after it', async () => {
      await seedItem('BV-ORDER');
      const ledger = fakeBudget(1_000);
      const generate = vi.fn<GenerateFn>(async () => {
        ledger.steps.push('generate');
        return { tags: ['a'], tokens: 123 };
      });

      expect(
        await tagPlatformItem('bilibili', 'BV-ORDER', deps({ generate, budget: ledger.budget })),
      ).toBe('tagged');
      expect(ledger.steps).toEqual(['remaining', 'generate', 'charge:123']);
    });

    it('charges a call whose answer had no usable tags', async () => {
      await seedItem('BV-EMPTY');
      const ledger = fakeBudget();
      const d = deps({ generate: makeGenerate([], 50), budget: ledger.budget });

      expect(await tagPlatformItem('bilibili', 'BV-EMPTY', d)).toBe('skipped');
      expect(ledger.spent).toBe(50);
    });

    it('charges the known spend of a failed call, then reports failed', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await seedItem('BV-BADJSON');
        const ledger = fakeBudget();
        const generate = vi.fn<GenerateFn>(async () => {
          throw new TaggingSpendError(77, new Error('bad json'));
        });

        expect(
          await tagPlatformItem('bilibili', 'BV-BADJSON', deps({ generate, budget: ledger.budget })),
        ).toBe('failed');
        expect(ledger.spent).toBe(77);
        expect(await db.select().from(schema.itemTags)).toHaveLength(0);
      } finally {
        errSpy.mockRestore();
      }
    });

    it('charges nothing for a failure that carries no spend', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await seedItem('BV-HTTP');
        const ledger = fakeBudget();
        const generate = vi.fn<GenerateFn>(async () => {
          throw new Error('HTTP 401');
        });

        expect(
          await tagPlatformItem('bilibili', 'BV-HTTP', deps({ generate, budget: ledger.budget })),
        ).toBe('failed');
        expect(ledger.spent).toBe(0);
      } finally {
        errSpy.mockRestore();
      }
    });

    it("keeps 'tagged' when charging fails: the money is already spent", async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const listener = vi.fn();
      const off = onDomainEvent('item-tagged', listener);
      try {
        await seedItem('BV-CHARGEFAIL');
        const ledger = fakeBudget();
        ledger.budget.charge.mockRejectedValue(new Error('storage down'));

        expect(
          await tagPlatformItem('bilibili', 'BV-CHARGEFAIL', deps({ budget: ledger.budget })),
        ).toBe('tagged');
        expect(await db.select().from(schema.itemTags)).toHaveLength(2);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        off();
        warnSpy.mockRestore();
      }
    });

    it('defers when the ledger cannot be read: no ledger, no spending', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await seedItem('BV-NOLEDGER');
        const ledger = fakeBudget();
        ledger.budget.remaining.mockRejectedValue(new Error('storage down'));
        const d = deps({ budget: ledger.budget });

        expect(await tagPlatformItem('bilibili', 'BV-NOLEDGER', d)).toBe('deferred');
        expect(d.generate).not.toHaveBeenCalled();
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });

    it('never consults the budget for an item that needs no LLM call', async () => {
      await seedItem('BV-ALREADY');
      await addTagToPlatformItem('bilibili', 'BV-ALREADY', 'manual', db);
      const ledger = fakeBudget(0);

      expect(
        await tagPlatformItem('bilibili', 'BV-ALREADY', deps({ budget: ledger.budget })),
      ).toBe('skipped');
      expect(
        await tagPlatformItem('bilibili', 'BV-MISSING', deps({ budget: ledger.budget })),
      ).toBe('skipped');
      expect(
        await tagPlatformItem(
          'bilibili',
          'BV-ALREADY',
          deps({ getConfig: async () => disabledConfig, budget: ledger.budget }),
        ),
      ).toBe('skipped');
      expect(ledger.budget.remaining).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Cross-tab item claim: each app.html tab runs its own Tags backlog drain
  // over the same shared DB, so one item must cost one LLM call, not one per tab
  // -------------------------------------------------------------------------

  describe('item claim', () => {
    it('skips an item whose claim another tab holds: no LLM call, no budget read, no rows', async () => {
      await seedItem('BV-HELD');
      const ledger = fakeBudget();
      const d = deps({ claim: heldElsewhere, budget: ledger.budget });

      expect(await tagPlatformItem('bilibili', 'BV-HELD', d)).toBe('skipped');
      expect(d.generate).not.toHaveBeenCalled();
      expect(ledger.budget.remaining).not.toHaveBeenCalled();
      expect(ledger.budget.charge).not.toHaveBeenCalled();
      expect(await db.select().from(schema.itemTags)).toHaveLength(0);
    });

    it('checks the candidate inside the claim: an item tagged before the claim was granted is skipped', async () => {
      await seedItem('BV-RACE');
      const claim: TaggingDeps['claim'] = async (_key, run) => {
        // The other tab tagged this item and released the claim just before ours was granted.
        await addTagToPlatformItem('bilibili', 'BV-RACE', 'other-tab', db);
        return run();
      };
      const d = deps({ claim });

      expect(await tagPlatformItem('bilibili', 'BV-RACE', d)).toBe('skipped');
      expect(d.generate).not.toHaveBeenCalled();
    });

    it('claims nothing when tagging is not configured', async () => {
      await seedItem('BV-NOCLAIM');
      const claimed: string[] = [];
      const claim: TaggingDeps['claim'] = (key, run) => {
        claimed.push(key);
        return run();
      };

      await tagPlatformItem('bilibili', 'BV-NOCLAIM', deps({ getConfig: async () => disabledConfig, claim }));

      expect(claimed).toEqual([]);
    });

    describe('default claim (Web Locks)', () => {
      afterEach(() => {
        vi.unstubAllGlobals();
      });

      /** Every seam injected except the claim, so the Web Locks default runs. */
      function depsWithDefaultClaim() {
        return {
          db: () => db,
          getConfig: async () => enabledConfig,
          generate: makeGenerate(),
          budget: fakeBudget().budget,
        };
      }

      function stubLocks(grant: boolean) {
        const request = vi.fn(
          async (
            name: string,
            _options: { ifAvailable?: boolean },
            callback: (lock: { name: string } | null) => Promise<unknown>,
          ) => callback(grant ? { name } : null),
        );
        vi.stubGlobal('navigator', { locks: { request } });
        return request;
      }

      it('asks for a non-blocking Web Lock named after the item and tags under it', async () => {
        await seedItem('BV-LOCK');
        const request = stubLocks(true);

        expect(await tagPlatformItem('bilibili', 'BV-LOCK', depsWithDefaultClaim())).toBe('tagged');
        expect(request).toHaveBeenCalledTimes(1);
        const [name, options] = request.mock.calls[0];
        expect(name).toContain('bilibili');
        expect(name).toContain('BV-LOCK');
        expect(options).toEqual({ ifAvailable: true });
      });

      it('skips without an LLM call when the lock is held elsewhere', async () => {
        await seedItem('BV-LOCKED');
        stubLocks(false);
        const d = depsWithDefaultClaim();

        expect(await tagPlatformItem('bilibili', 'BV-LOCKED', d)).toBe('skipped');
        expect(d.generate).not.toHaveBeenCalled();
      });

      it('fails rather than tagging unclaimed when navigator.locks is missing', async () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          await seedItem('BV-NOLOCKS');
          vi.stubGlobal('navigator', {});
          const d = depsWithDefaultClaim();

          expect(await tagPlatformItem('bilibili', 'BV-NOLOCKS', d)).toBe('failed');
          expect(d.generate).not.toHaveBeenCalled();
        } finally {
          errSpy.mockRestore();
        }
      });
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
          return { tags: ['技术'], tokens: 100 };
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

    it('ends the run at the first deferred item without throwing; progress stops there', async () => {
      // Cap 150, 100 tokens a call: the first call leaves 50 > 0, so the second
      // still goes out (D4's bounded overspend); the third finds -50 and defers.
      for (const id of ['tb1', 'tb2', 'tb3', 'tb4']) await seedItem(id, 'x');
      const ledger = fakeBudget(150);
      const generate = makeGenerate(['技术'], 100);
      const onProgress = vi.fn();

      await expect(
        tagNewItems('x', ['tb1', 'tb2', 'tb3', 'tb4'], deps({ generate, budget: ledger.budget }), onProgress),
      ).resolves.toBeUndefined();

      expect(generate).toHaveBeenCalledTimes(2);
      expect(ledger.spent).toBe(200);
      // tb4 is never claimed: the run stops instead of deferring item by item.
      expect(ledger.budget.remaining).toHaveBeenCalledTimes(3);
      expect(onProgress.mock.calls.map((c) => c[0])).toEqual([
        { done: 0, total: 4 },
        { done: 1, total: 4 },
        { done: 2, total: 4 },
      ]);
      const tagsById = await getTagsForPlatformItems('x', ['tb1', 'tb2', 'tb3', 'tb4'], db);
      expect(Object.keys(tagsById).sort()).toEqual(['tb1', 'tb2']);
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

    it('leaves the whole backlog pending when the day is already spent', async () => {
      await seedItem('x-wait-1', 'x');
      await seedItem('x-wait-2', 'x');
      const generate = makeGenerate();
      const onProgress = vi.fn();

      await tagPlatformBacklog('x', deps({ generate, budget: fakeBudget(0).budget }), onProgress);

      expect(generate).not.toHaveBeenCalled();
      expect(onProgress.mock.calls.map((call) => call[0])).toEqual([{ done: 0, total: 2 }]);
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

    it('resolves with an empty run when the LLM config cannot be read', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await seedItem('x-noconfig', 'x');
        const generate = makeGenerate();
        const onProgress = vi.fn();
        const getConfig = async (): Promise<ResolvedTaggingConfig> => {
          throw new Error('storage down');
        };

        await expect(
          tagPlatformBacklog('x', deps({ getConfig, generate }), onProgress),
        ).resolves.toBeUndefined();

        expect(generate).not.toHaveBeenCalled();
        expect(onProgress.mock.calls.map((call) => call[0])).toEqual([{ done: 0, total: 0 }]);
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
    });

    it('resolves with an empty run when the candidate query rejects', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        // The candidate query's builder chain, rejecting when awaited like a failed DB RPC.
        const query: Record<string, unknown> = {
          select: () => query,
          from: () => query,
          where: () => query,
          orderBy: () => query,
          then: (_resolve: unknown, reject: (err: Error) => void) => reject(new Error('db down')),
        };
        const generate = makeGenerate();
        const onProgress = vi.fn();

        await expect(
          tagPlatformBacklog(
            'x',
            deps({ db: () => query as unknown as FavbaseDb, generate }),
            onProgress,
          ),
        ).resolves.toBeUndefined();

        expect(generate).not.toHaveBeenCalled();
        expect(onProgress.mock.calls.map((call) => call[0])).toEqual([{ done: 0, total: 0 }]);
        expect(errSpy).toHaveBeenCalled();
      } finally {
        errSpy.mockRestore();
      }
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
