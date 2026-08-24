import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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

import { hybridRetrieve } from './retrieval';
import { getAllUsedTags } from '@/lib/tagging/tag-queries';
import { chatTools } from './tools';

const hybridRetrieveMock = vi.mocked(hybridRetrieve);
const getAllUsedTagsMock = vi.mocked(getAllUsedTags);

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
});
