import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import type { z } from 'zod';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import type { RetrievalHit } from './types';

// Mock the retrieval + tagging arms so tool tests are network-free and
// deterministic; getItemContent runs against real in-memory PGlite.
vi.mock('./retrieval', () => ({ hybridRetrieve: vi.fn() }));
vi.mock('@/lib/tagging/tag-queries', () => ({ getAllUsedTags: vi.fn() }));

// Provider readiness is a settings read, not a query: stub the resolvers so the
// coverage tool's blocker arm is driven from the test rather than a real store.
const providerState = vi.hoisted(() => ({ embedding: true, llm: true }));
vi.mock('@/lib/storage/settings', () => ({
  settingsStorage: { getValue: async () => ({}) },
}));
vi.mock('@/lib/embedding/config', () => ({
  resolveEmbeddingConfig: () => ({ enabled: providerState.embedding }),
}));
vi.mock('@/lib/storage/resolve', () => ({
  resolveLlmConfig: () => ({ enabled: providerState.llm }),
}));

import { hybridRetrieve } from './retrieval';
import { getAllUsedTags } from '@/lib/tagging/tag-queries';
import { COLLECTION_PLATFORMS, type CollectionPlatform } from '@/lib/collections/platforms';
import { PLATFORM_DESCRIPTORS } from '@/lib/collections/platform-descriptor';
import { deriveConfigurationBlockers } from '@/lib/collections/configuration-blockers';
import { CHAT_SYSTEM_PROMPT } from './prompts';
import { chatTools } from './tools';

const hybridRetrieveMock = vi.mocked(hybridRetrieve);
const getAllUsedTagsMock = vi.mocked(getAllUsedTags);

/**
 * Whole-token match, so the single-letter platform id `x` is not found inside
 * "text" or "index".
 */
function mentionsPlatform(text: string, platform: string): boolean {
  return new RegExp(`(^|[^a-z])${platform}([^a-z]|$)`, 'i').test(text);
}

/** Everything a tool puts in front of the model: its description + schema doc. */
function modelFacingText(toolDef: {
  description?: string;
  inputSchema: unknown;
}): string {
  const schema = toolDef.inputSchema as z.ZodType;
  return `${toolDef.description ?? ''}\n${schema.description ?? ''}`;
}

/** Invoke a tool's execute with a fake ToolExecutionOptions carrying the db. */
async function runTool<T>(
  toolDef: { execute?: (input: never, options: never) => unknown },
  input: unknown,
  db: FavbaseDb,
): Promise<T> {
  const execute = toolDef.execute;
  if (!execute) throw new Error('tool has no execute');
  const options = { toolCallId: 't1', messages: [], experimental_context: { db } };
  return (await execute(input as never, options as never)) as T;
}

describe('chatTools', () => {
  let pg: PGlite;
  let db: FavbaseDb;
  let itemId: string;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;

    const [author] = await db
      .insert(schema.authors)
      .values({ platform: 'test', platformAuthorId: 'a1', name: 'A' })
      .returning();
    const [item] = await db
      .insert(schema.items)
      .values({
        platform: 'bilibili',
        platformItemId: 'BV1',
        authorId: author.id,
        title: 'ML video',
        authorName: 'A',
        originalUrl: 'http://b/1',
        contentState: 'has_content',
      })
      .returning();
    itemId = item.id;
    await db
      .insert(schema.itemContents)
      .values({ itemId, plainText: '这是完整正文 full body text' });
  });

  afterAll(async () => {
    await pg.close();
  });

  describe('searchKnowledgeBase', () => {
    it('flattens hybridRetrieve hits to top-level result fields and passes filters through', async () => {
      const hits: RetrievalHit[] = [
        {
          chunkId: 'c1',
          chunkText: 'chunk one',
          score: 0.9,
          item: {
            id: 'i1',
            title: 'Title One',
            url: 'http://x/1',
            platform: 'bilibili',
          },
        },
      ];
      hybridRetrieveMock.mockResolvedValueOnce(hits);

      const out = await runTool<{ count: number; results: Record<string, unknown>[] }>(
        chatTools.searchKnowledgeBase,
        { query: 'ml', platform: 'bilibili', tag_id: 'tag-1', top_k: 5 },
        db,
      );

      expect(out.count).toBe(1);
      expect(out.results[0]).toEqual({
        item_id: 'i1',
        title: 'Title One',
        url: 'http://x/1',
        platform: 'bilibili',
        chunk_text: 'chunk one',
        score: 0.9,
      });
      const [passedDb, passedQuery, passedOpts] = hybridRetrieveMock.mock.calls.at(-1)!;
      expect(passedDb).toBe(db);
      expect(passedQuery).toBe('ml');
      expect(passedOpts).toEqual({ platform: 'bilibili', tagId: 'tag-1', topK: 5 });
    });

    it('defaults top_k to 8 and forwards platform/tagId', async () => {
      hybridRetrieveMock.mockResolvedValueOnce([]);
      const out = await runTool<{ count: number }>(
        chatTools.searchKnowledgeBase,
        { query: 'q' },
        db,
      );
      expect(out.count).toBe(0);
      const [, , opts] = hybridRetrieveMock.mock.calls.at(-1)!;
      expect(opts).toEqual({ platform: undefined, tagId: undefined, topK: 8 });
    });

    it('constrains platform to the collection-platform enum', () => {
      const inputSchema = chatTools.searchKnowledgeBase.inputSchema as unknown as z.ZodType;
      expect(inputSchema.safeParse({ query: 'q', platform: 'github' }).success).toBe(true);
      expect(inputSchema.safeParse({ query: 'q', platform: 'not-a-platform' }).success).toBe(false);
      expect(inputSchema.safeParse({ query: 'q' }).success).toBe(true); // filters optional
    });
  });

  describe('getItemContent', () => {
    it('reads the full plain text for an existing item (read-only)', async () => {
      const out = await runTool<{ found: boolean; item_id: string; content: string }>(
        chatTools.getItemContent,
        { item_id: itemId },
        db,
      );
      expect(out.found).toBe(true);
      expect(out.item_id).toBe(itemId);
      expect(out.content).toContain('完整正文');
    });

    it('returns found=false + empty content for a missing item', async () => {
      const out = await runTool<{ found: boolean; content: string }>(
        chatTools.getItemContent,
        { item_id: '00000000-0000-0000-0000-000000000000' },
        db,
      );
      expect(out.found).toBe(false);
      expect(out.content).toBe('');
    });
  });

  describe('listTags', () => {
    it('flattens getAllUsedTags to {count, tags:[{id,name,count}]}', async () => {
      getAllUsedTagsMock.mockResolvedValueOnce([
        { id: 'tg1', name: 'ml', count: 3 },
        { id: 'tg2', name: 'web', count: 1 },
      ]);
      const out = await runTool<{ count: number; tags: Record<string, unknown>[] }>(
        chatTools.listTags,
        { platform: 'bilibili' },
        db,
      );
      expect(out.count).toBe(2);
      expect(out.tags[0]).toEqual({ id: 'tg1', name: 'ml', count: 3 });
      expect(getAllUsedTagsMock).toHaveBeenCalledWith('bilibili', db);
    });
  });

  /**
   * The tool the whole task exists for: an empty `searchKnowledgeBase` result
   * has three very different causes (nothing saved / saved but still
   * processing / saved but no provider configured, so it never will be), and
   * only these counters plus `blockers` let a model tell them apart.
   *
   * Shares the outer fixture on purpose — there is no `afterEach` cleanup, so
   * the bilibili item seeded above is still present. This block adds one github
   * item and restores provider readiness itself.
   */
  describe('getProcessingCoverage', () => {
    interface CoverageEntry {
      platform: string;
      acquisition: { done: number; total: number | null };
      content: { done: number; total: number | null; kind: string };
      embedding: { done: number; total: number | null };
      tagging: { done: number; total: number | null };
      blockers: Array<{ capability: string; pending?: number }>;
    }

    beforeAll(async () => {
      const [author] = await db
        .insert(schema.authors)
        .values({ platform: 'github', platformAuthorId: 'gh1', name: 'GH' })
        .returning();
      await db.insert(schema.items).values({
        platform: 'github',
        platformItemId: 'repo1',
        authorId: author.id,
        title: 'repo',
        authorName: 'GH',
        originalUrl: 'http://gh/1',
        contentState: 'chunked',
      });
    });

    afterEach(() => {
      providerState.embedding = true;
      providerState.llm = true;
    });

    async function readCoverage(input: unknown = {}): Promise<CoverageEntry[]> {
      const out = await runTool<{ platforms: CoverageEntry[] }>(
        chatTools.getProcessingCoverage,
        input,
        db,
      );
      return out.platforms;
    }

    it('reports every platform, including ones with nothing synced', async () => {
      const platforms = await readCoverage();

      expect(platforms.map((entry) => entry.platform)).toEqual([...COLLECTION_PLATFORMS]);
      const untouched = platforms.find((entry) => entry.platform === 'youtube');
      expect(untouched?.acquisition).toEqual({ done: 0, total: null });
    });

    it('names the Content artefact from the descriptor, not a hand-written map', async () => {
      const platforms = await readCoverage();

      for (const entry of platforms) {
        expect(entry.content.kind).toBe(
          PLATFORM_DESCRIPTORS[entry.platform as CollectionPlatform].contentKind,
        );
      }
      // The mapping this feature exists for: a model must be able to say
      // "transcribed" about Bilibili rather than "completed content acquisition".
      expect(platforms.find((entry) => entry.platform === 'bilibili')?.content.kind).toBe(
        'transcript',
      );
    });

    it('keeps the acquisition denominator unknowable', async () => {
      const platforms = await readCoverage();

      for (const entry of platforms) {
        expect(entry.acquisition.total).toBeNull();
      }
    });

    it('reports the unconfigured providers a stage is waiting on', async () => {
      providerState.embedding = false;
      providerState.llm = false;

      const github = (await readCoverage()).find((entry) => entry.platform === 'github');

      expect(github?.embedding).toEqual({ done: 0, total: 1 });
      expect(github?.blockers).toEqual([
        { capability: 'embedding', pending: 1 },
        { capability: 'llm', pending: 1 },
      ]);
    });

    it('reports no blocker once the providers are configured', async () => {
      const github = (await readCoverage()).find((entry) => entry.platform === 'github');

      expect(github?.blockers).toEqual([]);
    });

    it('never reports the ASR blocker, whose signal is not visible here', async () => {
      providerState.embedding = false;
      providerState.llm = false;

      const platforms = await readCoverage();

      expect(
        platforms.flatMap((entry) => entry.blockers.map((blocker) => blocker.capability)),
      ).not.toContain('asr');
    });

    it('returns only the requested platform', async () => {
      const platforms = await readCoverage({ platform: 'github' });

      expect(platforms).toHaveLength(1);
      expect(platforms[0].platform).toBe('github');
      expect(platforms[0].content).toEqual({ done: 1, total: 1, kind: 'readme' });
    });
  });

  /**
   * docs/26 appendix A item 3: `z.enum(COLLECTION_PLATFORMS)` is derived,
   * so the schema accepts a newly onboarded platform while a hand-written prose
   * list keeps telling the model only the old ones exist — Chat and the Agent
   * Bridge then never filter by it. Both halves of the model-facing surface (the
   * tool texts and the system prompt) are checked here rather than split
   * across two files: one rule, one place, or it rots in whichever half is
   * forgotten.
   *
   * The contract is "no PARTIAL list", not "always list them": `getItemContent`
   * legitimately names no platform at all.
   */
  describe('model-facing platform list', () => {
    it('never shows the model a partial platform list', () => {
      const surfaces: [string, string][] = [
        ...Object.entries(chatTools).map(
          ([name, toolDef]) => [`chatTools.${name}`, modelFacingText(toolDef)] as [string, string],
        ),
        ['CHAT_SYSTEM_PROMPT', CHAT_SYSTEM_PROMPT],
      ];
      const partial = surfaces
        .filter(([, text]) => COLLECTION_PLATFORMS.some((p) => mentionsPlatform(text, p)))
        .flatMap(([name, text]) => {
          const absent = COLLECTION_PLATFORMS.filter((p) => !mentionsPlatform(text, p));
          return absent.length > 0 ? [`${name}: missing ${absent.join(', ')}`] : [];
        });
      expect(
        partial,
        `model-facing text enumerates platforms by hand (derive it from COLLECTION_PLATFORMS):\n${partial.join('\n')}`,
      ).toEqual([]);
    });

    it('tells the model about every platform the schema accepts', () => {
      // The tool list is derived from the schemas, not hand-written: a tool
      // added later that accepts the platform enum is held to the same rule
      // without anyone remembering to name it here.
      const platformAware = Object.entries(chatTools).filter(([, toolDef]) => {
        const shape = (toolDef.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
        return shape != null && 'platform' in shape;
      });
      // Reverse assertion: if the shape introspection above ever stops working,
      // `platformAware` goes empty and the loop below would pass vacuously.
      expect(platformAware.map(([name]) => name).sort()).toEqual([
        'getProcessingCoverage',
        'listTags',
        'searchKnowledgeBase',
      ]);

      for (const [name, toolDef] of platformAware) {
        const text = modelFacingText(toolDef);
        for (const platform of COLLECTION_PLATFORMS) {
          expect(mentionsPlatform(text, platform), `${name}: ${platform}`).toBe(true);
        }
      }
      for (const platform of COLLECTION_PLATFORMS) {
        expect(mentionsPlatform(CHAT_SYSTEM_PROMPT, platform), `system prompt: ${platform}`).toBe(true);
      }
    });

    // Same failure mode one field over: `content.kind` is only useful if the
    // model was told what the values mean, and a hand-written kind list would
    // go stale the same way a hand-written platform list does — silently, with
    // the model falling back to 「已完成正文获取」 for the new platform.
    it('tells the model every content kind it can be handed', () => {
      const text = modelFacingText(chatTools.getProcessingCoverage);
      const kinds = [
        ...new Set(COLLECTION_PLATFORMS.map((p) => PLATFORM_DESCRIPTORS[p].contentKind)),
      ];
      expect(kinds.length).toBeGreaterThan(1);
      for (const kind of kinds) expect(text, kind).toContain(kind);
    });

    // The feature's two documented limits (PRD D4 / `CONTEXT.md:163`) exist
    // ONLY as prose in this description — nothing else stops a model from
    // reading an empty `blockers` as "still working, try later" or an
    // `acquisition.done` as a completed sync. Both are exactly the misleading
    // answer the tool was built to prevent, so both are pinned here.
    it('scopes the blocker list and the acquisition denominator honestly', () => {
      const text = modelFacingText(chatTools.getProcessingCoverage);

      // Derived, not hand-written: the capabilities the tool can actually emit
      // are whatever the shared rule yields with no state-machine signal —
      // the same `asrBlocked: false` the tool passes. Wire ASR up later and
      // this fails until the text names it too.
      const reportable = deriveConfigurationBlockers({
        coverage: {
          acquisition: { done: 1, total: null },
          content: { done: 0, total: 1 },
          embedding: { done: 0, total: 1 },
          tagging: { done: 0, total: 1 },
        },
        asrBlocked: false,
        asrConfigured: false,
        embeddingConfigured: false,
        llmConfigured: false,
      }).map((blocker) => blocker.capability);

      expect(reportable.length).toBeGreaterThan(0);
      for (const capability of reportable) expect(text, capability).toContain(capability);
      // Content is a stage with no blocker judgement here, so the text must say
      // an empty list proves nothing about it.
      expect(text).toContain('content.done');
      expect(text).toContain('acquisition.total');
    });
  });
});
