import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { z } from 'zod';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import type { RetrievalHit } from './types';

// Mock the retrieval + tagging arms so tool tests are network-free and
// deterministic; getItemContent runs against real in-memory PGlite.
vi.mock('./retrieval', () => ({ hybridRetrieve: vi.fn() }));
vi.mock('@/lib/tagging/tag-queries', () => ({ searchUsedTags: vi.fn() }));

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
import { searchUsedTags } from '@/lib/tagging/tag-queries';
import { COLLECTION_PLATFORMS, type CollectionPlatform } from '@/lib/collections/platforms';
import { PLATFORM_DESCRIPTORS } from '@/lib/collections/platform-descriptor';
import { deriveConfigurationBlockers } from '@/lib/collections/configuration-blockers';
import { CHAT_SYSTEM_PROMPT } from './prompts';
import { chatTools } from './tools';

const hybridRetrieveMock = vi.mocked(hybridRetrieve);
const searchUsedTagsMock = vi.mocked(searchUsedTags);

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
    const HIT: RetrievalHit = {
      chunkId: 'c1',
      chunkText: 'chunk one',
      score: 0.9,
      similarity: 0.42,
      matchedTerms: ['ml'],
      item: {
        id: 'i1',
        title: 'Title One',
        url: 'http://x/1',
        platform: 'bilibili',
      },
    };

    interface SearchOutput {
      count: number;
      query_terms: string[];
      semantic_search: boolean;
      results: Record<string, unknown>[];
    }

    function search(input: unknown): Promise<SearchOutput> {
      return runTool<SearchOutput>(chatTools.searchKnowledgeBase, input, db);
    }

    it('flattens hybridRetrieve hits to top-level result fields and passes filters through', async () => {
      hybridRetrieveMock.mockResolvedValueOnce({
        hits: [HIT],
        queryTerms: ['ml', 'rust'],
        semanticSearch: true,
      });

      const out = await search({ query: 'ml', platform: 'bilibili', tag_id: 'tag-1', top_k: 5 });

      expect(out.count).toBe(1);
      expect(out.query_terms).toEqual(['ml', 'rust']);
      expect(out.semantic_search).toBe(true);
      // The pre-evidence fields keep their names and values (the published
      // CLI prints this object verbatim); the evidence fields are additive.
      expect(out.results[0]).toEqual({
        item_id: 'i1',
        title: 'Title One',
        url: 'http://x/1',
        platform: 'bilibili',
        chunk_text: 'chunk one',
        score: 0.9,
        similarity: 0.42,
        matched_terms: ['ml'],
      });
      const [passedDb, passedQuery, passedOpts] = hybridRetrieveMock.mock.calls.at(-1)!;
      expect(passedDb).toBe(db);
      expect(passedQuery).toBe('ml');
      expect(passedOpts).toEqual({ platform: 'bilibili', tagId: 'tag-1', topK: 5 });
    });

    it('passes a null similarity through when the semantic arm did not run', async () => {
      hybridRetrieveMock.mockResolvedValueOnce({
        hits: [{ ...HIT, similarity: null }],
        queryTerms: ['ml'],
        semanticSearch: false,
      });

      const out = await search({ query: 'ml' });

      expect(out.semantic_search).toBe(false);
      expect(out.results[0].similarity).toBeNull();
    });

    it('defaults top_k to 8 and forwards platform/tagId', async () => {
      hybridRetrieveMock.mockResolvedValueOnce({ hits: [], queryTerms: [], semanticSearch: true });
      const out = await search({ query: 'q' });
      expect(out.count).toBe(0);
      expect(out.results).toEqual([]);
      const [, , opts] = hybridRetrieveMock.mock.calls.at(-1)!;
      expect(opts).toEqual({ platform: undefined, tagId: undefined, topK: 8 });
    });

    /**
     * Gotcha 2 (silent-failure guide): RRF always ranks something, so the
     * tool returns a full list for a question the library knows nothing
     * about. The only defence is what the model is told about `score` and
     * about the evidence fields; nothing else stops it reading `count > 0`
     * as "the user saved this".
     */
    describe('model-facing honesty', () => {
      const text = () => modelFacingText(chatTools.searchKnowledgeBase);
      const sentenceWith = (source: string, token: string) =>
        source.split('。').find((s) => s.includes(token));

      it('no longer claims count is 0 when nothing is relevant', () => {
        expect(text()).not.toMatch(/无相关[^。]*count\s*为\s*0/);
        // Where count is mentioned, relevance is sent to the evidence fields.
        const countSentence = sentenceWith(text(), 'count');
        expect(countSentence, 'count is still explained').toBeDefined();
        expect(countSentence).toContain('matched_terms');
        expect(countSentence).toContain('similarity');
        // The system prompt's "nothing found" rule reads the same evidence.
        expect(sentenceWith(CHAT_SYSTEM_PROMPT, 'count')).toContain('matched_terms');
      });

      /** Every field a real output carries, top level and per result. */
      async function returnedFields(): Promise<string[]> {
        hybridRetrieveMock.mockResolvedValueOnce({
          hits: [HIT],
          queryTerms: ['ml'],
          semanticSearch: true,
        });
        const out = await search({ query: 'ml' });
        const fields = [...Object.keys(out), ...Object.keys(out.results[0])];
        // Non-vacuity: reading the fields off the output must keep working.
        expect(fields).toEqual(
          expect.arrayContaining(['query_terms', 'semantic_search', 'similarity', 'matched_terms']),
        );
        return fields;
      }

      it('describes every field it returns', async () => {
        // Payload a model reads without being told; everything else needs a
        // sentence, so a field added later reds here until it gets one.
        const SELF_EVIDENT = ['results', 'title', 'url', 'platform', 'chunk_text'];
        const fields = (await returnedFields()).filter((field) => !SELF_EVIDENT.includes(field));
        for (const field of fields) expect(text(), field).toContain(field);
      });

      // The other readers of this output: an agent through the CLI reads
      // SKILL.md, a person reads the npm README, and the CLI prints the object
      // verbatim. 1f5c6a2 added four fields and neither hand-written shape
      // followed. Scoped to the first `{ … }` code span after the sentence that
      // introduces search's output: step 2's prose names the evidence fields
      // too, and the README paragraph also holds `get`'s shape.
      it.each([
        ['skills/favbase/SKILL.md', '`favbase search "<query>"` runs'],
        ['packages/favbase/README.md', '`search` runs'],
      ])('%s spells every returned field in its output shape', async (doc, lead) => {
        const source = readFileSync(path.resolve(__dirname, '..', '..', doc), 'utf8');
        const at = source.indexOf(lead);
        expect(at, `${doc} no longer introduces search's output with ${lead}`).toBeGreaterThanOrEqual(0);
        const shape = /`(\{[^`]*\})`/.exec(source.slice(at + lead.length))?.[1];
        expect(shape, `${doc}: no \`{ … }\` output shape after ${lead}`).toBeDefined();

        const missing = (await returnedFields()).filter(
          (field) => !new RegExp(`\\b${field}\\b`).test(shape!),
        );
        expect(missing, `${doc}: fields searchKnowledgeBase returns but the shape omits`).toEqual([]);
      });

      it('says score only orders this list', () => {
        const scoreSentence = sentenceWith(text(), 'score');
        expect(scoreSentence).toContain('排序');
        expect(scoreSentence).toContain('跨查询');
        expect(scoreSentence).toContain('置信度');
      });

      it('says both reasons a query word is missing from query_terms', () => {
        // The keyword arm drops a word with df = 0 and a word above the df cap
        // (`keywordArm` in retrieval.ts). A model told only about the second
        // reads a missing rare word as "too common" instead of "not saved".
        const clause = text()
          .split(/[。；]/)
          .find((s) => s.includes('不会出现在其中'));
        expect(clause, 'the omission clause').toBeDefined();
        expect(clause).toContain('一次都没出现过');
        expect(clause).toContain('常见词');
      });

      it('says what semantic_search=false means and what a thin result calls for', () => {
        expect(sentenceWith(text(), 'semantic_search=false')).toContain('只跑了关键词检索');
        expect(sentenceWith(text(), '三种成因')).toContain('getProcessingCoverage');
      });
    });

    it('constrains platform to the collection-platform enum', () => {
      const inputSchema = chatTools.searchKnowledgeBase.inputSchema as unknown as z.ZodType;
      expect(inputSchema.safeParse({ query: 'q', platform: 'github' }).success).toBe(true);
      expect(inputSchema.safeParse({ query: 'q', platform: 'not-a-platform' }).success).toBe(false);
      expect(inputSchema.safeParse({ query: 'q' }).success).toBe(true); // filters optional
    });
  });

  /**
   * Two flags, two questions (docs/27 Step 6): `item_exists` says whether the id
   * names a Collection Item at all, `found` whether that item has an extracted
   * body. Before `item_exists` a mistyped id and an item still waiting for its
   * body both came back as `found: false`, so the model could not tell "the id
   * is wrong" from "not extracted yet".
   *
   * Seeds its own body-less item. The outer fixture has no `afterEach` cleanup,
   * so this item is still present when `getProcessingCoverage` runs below; it is
   * a bilibili item, and that block asserts nothing about bilibili counts.
   */
  describe('getItemContent', () => {
    interface ItemContentResult {
      found: boolean;
      item_exists: boolean;
      item_id: string;
      content: string;
    }
    let bodylessItemId: string;

    beforeAll(async () => {
      const [author] = await db
        .insert(schema.authors)
        .values({ platform: 'bilibili', platformAuthorId: 'a-bodyless', name: 'B' })
        .returning();
      const [item] = await db
        .insert(schema.items)
        .values({
          platform: 'bilibili',
          platformItemId: 'BV-bodyless',
          authorId: author.id,
          title: 'not transcribed yet',
          authorName: 'B',
          originalUrl: 'http://b/bodyless',
          contentState: 'pending',
        })
        .returning();
      bodylessItemId = item.id;
    });

    function readItem(item_id: string): Promise<ItemContentResult> {
      return runTool<ItemContentResult>(chatTools.getItemContent, { item_id }, db);
    }

    it('reads the full plain text for an existing item (read-only)', async () => {
      const out = await readItem(itemId);
      expect(out).toMatchObject({ found: true, item_exists: true, item_id: itemId });
      expect(out.content).toContain('完整正文');
    });

    it('says the id is wrong when no Collection Item has it', async () => {
      const missing = '00000000-0000-0000-0000-000000000000';
      expect(await readItem(missing)).toEqual({
        found: false,
        item_exists: false,
        item_id: missing,
        content: '',
      });
    });

    // The state the old single-table query could not see: it asked
    // `item_contents` only, so this item looked exactly like a wrong id.
    it('tells an item without an extracted body apart from a wrong id', async () => {
      expect(await readItem(bodylessItemId)).toEqual({
        found: false,
        item_exists: true,
        item_id: bodylessItemId,
        content: '',
      });
    });

    // Gotcha 2 (silent-failure guide): what each flag means, and what to do
    // about it, exists only as prose in the description. The flags are read off
    // a real result rather than listed by hand, so a state flag added later
    // without being explained to the model reds here.
    it('explains every state flag it returns to the model', async () => {
      const text = modelFacingText(chatTools.getItemContent);
      const flags = Object.entries(await readItem(bodylessItemId))
        .filter(([, value]) => typeof value === 'boolean')
        .map(([key]) => key);

      // Non-vacuity: if reading the flags ever breaks, the loop below would pass
      // on an empty list.
      expect(flags).toEqual(expect.arrayContaining(['found', 'item_exists']));
      for (const flag of flags) expect(text, flag).toContain(`${flag}=false`);

      // Each next step is checked inside the sentence that introduces its
      // state. A whole-text match is vacuous for "wrong id": the opening
      // sentence and the schema doc both name searchKnowledgeBase already, so
      // deleting the "take the id again from search" advice stayed green.
      const sentenceWith = (token: string) => text.split('。').find((s) => s.includes(token));
      expect(sentenceWith('item_exists=false'), 'wrong id: go back to search').toContain(
        'searchKnowledgeBase',
      );
      // "Exists, no body yet" points at the progress tool, not a retry.
      expect(sentenceWith('found=false'), 'no body yet: ask for progress').toContain(
        'getProcessingCoverage',
      );
    });
  });

  /**
   * Bounded since 2026-10-14: a real library had 1924 tags (~210 KB). The cut
   * is the tool's blind spot, so `total` / `truncated` / `hint` exist only to
   * say a list was cut, and the description says what to do about it.
   */
  describe('listTags', () => {
    interface TagsOutput {
      count: number;
      total: number;
      truncated: boolean;
      hint: string | null;
      tags: Record<string, unknown>[];
    }

    const TAGS = [
      { id: 'tg1', name: 'ml', count: 3 },
      { id: 'tg2', name: 'web', count: 1 },
    ];

    function listTags(input: unknown): Promise<TagsOutput> {
      return runTool<TagsOutput>(chatTools.listTags, input, db);
    }

    const inputSchema = () => chatTools.listTags.inputSchema as unknown as z.ZodType;

    /** The limit bounds as advertised to agents (the Agent Bridge emits this JSON Schema). */
    function limitBounds(): { minimum: number; maximum: number } {
      const json = z.toJSONSchema(inputSchema(), { io: 'input' }) as {
        properties?: Record<string, { minimum?: number; maximum?: number }>;
      };
      const { minimum, maximum } = json.properties?.limit ?? {};
      expect(minimum, 'listTags.limit no longer emits a JSON Schema `minimum`').toBeTypeOf('number');
      expect(maximum, 'listTags.limit no longer emits a JSON Schema `maximum`').toBeTypeOf('number');
      return { minimum: minimum!, maximum: maximum! };
    }

    /** The limit execute passes when the caller sends none. */
    async function observedDefaultLimit(): Promise<number> {
      searchUsedTagsMock.mockResolvedValueOnce({ tags: [], total: 0 });
      await listTags({});
      return searchUsedTagsMock.mock.calls.at(-1)![0].limit;
    }

    it('returns {count,total,truncated,hint,tags} and passes the filters through', async () => {
      searchUsedTagsMock.mockResolvedValueOnce({ tags: TAGS, total: 2 });

      const out = await listTags({ platform: 'bilibili', query: 'ml', limit: 5 });

      // `count` and `tags[{id,name,count}]` keep their pre-limit meaning (the
      // published CLI prints this object verbatim); the rest is additive.
      expect(out).toEqual({ count: 2, total: 2, truncated: false, hint: null, tags: TAGS });
      expect(searchUsedTagsMock).toHaveBeenLastCalledWith(
        { platform: 'bilibili', query: 'ml', limit: 5 },
        db,
      );
    });

    // Q2: the default applies to every caller that sends no limit, the
    // published CLI included -- the extension cannot tell them apart.
    it('asks for 50 tags when the caller sends no limit', async () => {
      expect(await observedDefaultLimit()).toBe(50);
      expect(searchUsedTagsMock.mock.calls.at(-1)![0]).toEqual({
        platform: undefined,
        query: undefined,
        limit: 50,
      });
    });

    it('flags a cut page and says in hint how to find the rest', async () => {
      searchUsedTagsMock.mockResolvedValueOnce({ tags: TAGS, total: 1924 });

      const out = await listTags({});

      expect(out).toMatchObject({ count: 2, total: 1924, truncated: true });
      expect(out.hint).toContain('1924');
      expect(out.hint).toContain('前 2 个');
      expect(out.hint).toContain('query');
      expect(out.hint).toContain(`最大 ${limitBounds().maximum}`);
    });

    it('accepts limit 1 and 200 and refuses 0, 201 and non-integers', () => {
      const schema = inputSchema();
      for (const limit of [1, 200]) {
        expect(schema.safeParse({ limit }).success, `limit ${limit}`).toBe(true);
      }
      for (const limit of [0, 201, 2.5]) {
        expect(schema.safeParse({ limit }).success, `limit ${limit}`).toBe(false);
      }
      expect(schema.safeParse({}).success).toBe(true);
      expect(schema.safeParse({ query: '学习', platform: 'github' }).success).toBe(true);
    });

    describe('model-facing honesty', () => {
      const description = () => chatTools.listTags.description ?? '';

      it('describes every field it returns', async () => {
        searchUsedTagsMock.mockResolvedValueOnce({ tags: TAGS, total: 1924 });
        const out = await listTags({});
        // `count` and `id` predate the cut and their tokens occur in the text
        // for other reasons (`tag_id`), so checking them here would be vacuous.
        const SELF_EVIDENT = ['tags', 'id', 'name', 'count'];
        const fields = [...Object.keys(out), ...Object.keys(out.tags[0])].filter(
          (field) => !SELF_EVIDENT.includes(field),
        );

        // Non-vacuity: reading the fields off the output must keep working.
        expect(fields).toEqual(expect.arrayContaining(['total', 'truncated', 'hint']));
        for (const field of fields) expect(description(), field).toContain(field);
      });

      it('sends a cut list to query, and a missed query to other words', () => {
        const sentence = description()
          .split('。')
          .find((s) => s.includes('truncated'));
        expect(sentence, 'the truncated sentence').toBeDefined();
        expect(sentence, 'the instruction itself, not just the word').toContain('用 query');
        expect(sentence).toContain('同义词');
      });

      it('states the limit range and default that the schema and execute enforce', async () => {
        const { minimum, maximum } = limitBounds();
        const fallback = await observedDefaultLimit();

        const clause = (inputSchema().description ?? '').split('limit=')[1];
        expect(clause, 'the describe string no longer documents limit').toBeDefined();
        expect(clause).toContain(`${minimum}-${maximum}`);
        expect(clause).toContain(`默认 ${fallback}`);
        // The description's opening promise is the same number.
        expect(description()).toContain(`前 ${fallback} 个`);
      });
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

    it('never reports a transcription prerequisite (ASR key, platform tab), whose signal is not visible here', async () => {
      providerState.embedding = false;
      providerState.llm = false;

      const platforms = await readCoverage();

      const capabilities = platforms.flatMap((entry) => entry.blockers.map((blocker) => blocker.capability));
      expect(capabilities).not.toContain('asr');
      expect(capabilities).not.toContain('platform-tab');
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
      // the same `prerequisiteBlocked: null` the tool passes. Wire a
      // transcription prerequisite up later and this fails until the text
      // names it too.
      const reportable = deriveConfigurationBlockers({
        coverage: {
          acquisition: { done: 1, total: null },
          content: { done: 0, total: 1 },
          embedding: { done: 0, total: 1 },
          tagging: { done: 0, total: 1 },
        },
        prerequisiteBlocked: null,
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
