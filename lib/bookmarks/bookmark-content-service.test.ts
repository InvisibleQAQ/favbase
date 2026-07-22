import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import { and, eq } from 'drizzle-orm';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';

const { backgroundSendMessage } = vi.hoisted(() => ({ backgroundSendMessage: vi.fn() }));

vi.mock('wxt/browser', () => ({
  browser: { runtime: { sendMessage: backgroundSendMessage } },
}));

import {
  syncBookmarkTreeToDb,
  type BookmarkEntry,
  type BookmarkFolder,
  type BookmarkTree,
} from './bookmarks-sync-service';
import {
  extractPendingBookmarks,
  type BookmarkPageFetcher,
  type ExtractionProgress,
} from './bookmark-content-service';
import { fetchBookmarkPage, type FetchFn } from './bookmark-content';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function folder(id: string, title: string): BookmarkFolder {
  return { id, title, path: title };
}

function bm(url: string, folderId = '1'): BookmarkEntry {
  return {
    normalizedUrl: url,
    url,
    title: url,
    domain: new URL(url).hostname,
    dateAdded: 1000,
    folderId,
  };
}

function tree(bookmarks: BookmarkEntry[]): BookmarkTree {
  return { folders: [folder('1', 'Bar')], bookmarks };
}

/** Article HTML that clears the 200-char extraction threshold. */
function articleHtml(marker: string): string {
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) =>
      `<p>${marker} paragraph ${i} with enough prose to clear the two-hundred character extraction threshold comfortably and without ambiguity.</p>`,
  ).join('\n');
  return `<!doctype html><html><head><title>${marker}</title></head><body><article><h1>${marker} Title</h1>${paragraphs}</article></body></html>`;
}

/** Minimal Response stand-in (fetchBookmarkPage's surface only). */
function htmlResponse(html: string, status = 200, contentType: string | null = 'text/html'): Response {
  const bytes = new TextEncoder().encode(html);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
    body: null, // readBodyCapped falls back to arrayBuffer()
    arrayBuffer: async () => bytes.buffer,
  } as unknown as Response;
}

/** Route responses by URL — processing order of same-batch items is not deterministic. */
function fetchStub(routes: Record<string, () => Response>): FetchFn {
  return async (url) => {
    const route = routes[url];
    if (!route) throw new TypeError(`no route for ${url}`);
    return route();
  };
}

function pageFetcher(routes: Record<string, () => Response>): BookmarkPageFetcher {
  const fetchFn = fetchStub(routes);
  return (url) => fetchBookmarkPage(url, fetchFn);
}

describe('bookmark-content-service (in-memory PGlite)', () => {
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
    backgroundSendMessage.mockReset();
    // items delete cascades item_contents / item_chunks / item_sources FKs,
    // but item_sources is cleared first to keep parity with the sync suite.
    await db.delete(schema.itemSources);
    await db.delete(schema.items);
    await db.delete(schema.authors);
    await db.delete(schema.sources);
  });

  async function getItem(url: string) {
    const rows = await db
      .select()
      .from(schema.items)
      .where(and(eq(schema.items.platform, 'bookmarks'), eq(schema.items.platformItemId, url)));
    return rows[0];
  }

  async function getContent(itemId: string) {
    const rows = await db
      .select()
      .from(schema.itemContents)
      .where(eq(schema.itemContents.itemId, itemId));
    return rows[0];
  }

  async function getChunks(itemId: string) {
    return db.select().from(schema.itemChunks).where(eq(schema.itemChunks.itemId, itemId));
  }

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('reports the current bookmark identity before fetching it', async () => {
    const url = 'https://identity.example.com/post';
    const entry = { ...bm(url), title: 'Readable bookmark title' };
    await syncBookmarkTreeToDb(db, tree([entry]));

    const progress: ExtractionProgress[] = [];
    await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: pageFetcher({ [url]: () => htmlResponse(articleHtml('Identity')) }),
      onProgress: (value) => progress.push(value),
    });

    expect(progress).toContainEqual({
      done: 0,
      total: 1,
      current: { url, title: 'Readable bookmark title' },
    });
  });

  it('pending → chunked: markdown persisted to item_contents + chunks written', async () => {
    const url = 'https://ok.example.com/post';
    await syncBookmarkTreeToDb(db, tree([bm(url)]));
    expect((await getItem(url)).contentState).toBe('pending');

    const progress: ExtractionProgress[] = [];
    const result = await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: pageFetcher({ [url]: () => htmlResponse(articleHtml('Alpha')) }),
      onProgress: (p) => progress.push(p),
    });

    expect(result).toEqual({
      processed: 1,
      chunkedItemIds: [url],
      noContent: 0,
      transient: 0,
    });
    expect(progress).toEqual([
      { done: 0, total: 1 },
      {
        done: 0,
        total: 1,
        current: { url, title: url },
      },
      {
        done: 1,
        total: 1,
        current: { url, title: url },
      },
    ]);

    const item = await getItem(url);
    expect(item.contentState).toBe('chunked');
    const content = await getContent(item.id);
    expect(content.plainText).toContain('Alpha paragraph 0');
    expect(content.plainText.length).toBeGreaterThanOrEqual(200);
    const chunks = await getChunks(item.id);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].chunkText).toContain('Alpha');
    expect(chunks[0].startSec).toBeNull(); // text content — no timestamps
  });

  it('uses the background fetch seam when production does not inject fetchPage', async () => {
    const url = 'https://background.example.com/post';
    await syncBookmarkTreeToDb(db, tree([bm(url)]));
    backgroundSendMessage.mockResolvedValueOnce({ kind: 'ok', html: articleHtml('Background') });
    const ambientFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('app.html must not fetch third-party bookmark pages'),
    );

    try {
      const result = await extractPendingBookmarks({ db, delayMs: 0 });

      expect(result.chunkedItemIds).toEqual([url]);
      expect(backgroundSendMessage).toHaveBeenCalledWith({ type: 'FETCH_BOOKMARK_PAGE', url });
      expect(ambientFetch).not.toHaveBeenCalled();
    } finally {
      ambientFetch.mockRestore();
    }
  });

  // -------------------------------------------------------------------------
  // Permanent failures → no_content
  // -------------------------------------------------------------------------

  it('4xx / non-HTML / empty-shell pages settle as no_content (no content rows)', async () => {
    const dead = 'https://dead.example.com/x';
    const pdf = 'https://pdf.example.com/doc';
    const shell = 'https://spa.example.com/app';
    await syncBookmarkTreeToDb(db, tree([bm(dead), bm(pdf), bm(shell)]));

    const result = await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: pageFetcher({
        [dead]: () => htmlResponse('gone', 404),
        [pdf]: () => htmlResponse('%PDF-', 200, 'application/pdf'),
        [shell]: () => htmlResponse('<html><body><div id="root"></div></body></html>'),
      }),
    });

    expect(result.processed).toBe(3);
    expect(result.noContent).toBe(3);
    expect(result.chunkedItemIds).toEqual([]);
    for (const url of [dead, pdf, shell]) {
      const item = await getItem(url);
      expect(item.contentState).toBe('no_content');
      expect(await getContent(item.id)).toBeUndefined();
    }
  });

  it('unfetchable URLs (localhost) settle as no_content without a request', async () => {
    const local = 'http://localhost:9000/dev';
    await syncBookmarkTreeToDb(db, tree([bm(local)]));

    const fetchPage = vi.fn<BookmarkPageFetcher>();
    const result = await extractPendingBookmarks({ db, delayMs: 0, fetchPage });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(result.noContent).toBe(1);
    expect((await getItem(local)).contentState).toBe('no_content');
  });

  // -------------------------------------------------------------------------
  // Transient failures stay pending + resume on the next run
  // -------------------------------------------------------------------------

  it('5xx stays pending (run terminates), the next run picks it up (resume)', async () => {
    const url = 'https://flaky.example.com/a';
    await syncBookmarkTreeToDb(db, tree([bm(url)]));

    const first = await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: pageFetcher({ [url]: () => htmlResponse('oops', 500) }),
    });
    expect(first).toEqual({ processed: 1, chunkedItemIds: [], noContent: 0, transient: 1 });
    expect((await getItem(url)).contentState).toBe('pending');

    const second = await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: pageFetcher({ [url]: () => htmlResponse(articleHtml('Beta')) }),
    });
    expect(second.chunkedItemIds).toEqual([url]);
    expect((await getItem(url)).contentState).toBe('chunked');
  });

  // -------------------------------------------------------------------------
  // Per-item failure isolation
  // -------------------------------------------------------------------------

  it('a throwing DB write for one item does not abort the run', async () => {
    const bad = 'https://bad.example.com/x';
    const good = 'https://good.example.com/y';
    await syncBookmarkTreeToDb(db, tree([bm(bad), bm(good)]));

    // Sabotage the state UPDATE of the bad item only: processing is serial, so
    // arming the flag from its fetch route targets exactly its DB write.
    let sabotage = false;
    const flakyDb = new Proxy(db as object, {
      get(target, prop) {
        if (prop === 'update' && sabotage) {
          sabotage = false;
          return () => {
            throw new Error('injected update failure');
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? (value as CallableFunction).bind(target) : value;
      },
    }) as FavbaseDb;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await extractPendingBookmarks({
        db: flakyDb,
        delayMs: 0,
        fetchPage: pageFetcher({
          [bad]: () => {
            sabotage = true;
            return htmlResponse('gone', 404);
          },
          [good]: () => htmlResponse(articleHtml('Gamma')),
        }),
      });

      expect(result.processed).toBe(2);
      expect(result.transient).toBe(1); // the sabotaged item, left pending
      expect(result.chunkedItemIds).toEqual([good]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    expect((await getItem(bad)).contentState).toBe('pending');
    expect((await getItem(good)).contentState).toBe('chunked');
  });

  // -------------------------------------------------------------------------
  // Per-item completion callback (embed/tag seam)
  // -------------------------------------------------------------------------

  it('onItemExtracted fires exactly for chunked items', async () => {
    const good = 'https://good.example.com/post';
    const dead = 'https://dead.example.com/x';
    const flaky = 'https://flaky.example.com/y';
    await syncBookmarkTreeToDb(db, tree([bm(good), bm(dead), bm(flaky)]));

    const extracted: string[] = [];
    const result = await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: pageFetcher({
        [good]: () => htmlResponse(articleHtml('Delta')),
        [dead]: () => htmlResponse('gone', 404),
        [flaky]: () => htmlResponse('oops', 500),
      }),
      onItemExtracted: (id) => extracted.push(id),
    });

    expect(extracted).toEqual([good]); // not the no_content / transient items
    expect(result.chunkedItemIds).toEqual([good]);
  });

  it('a throwing onItemExtracted listener does not abort the run', async () => {
    const a = 'https://a.example.com/1';
    const b = 'https://b.example.com/2';
    await syncBookmarkTreeToDb(db, tree([bm(a), bm(b)]));

    const extracted: string[] = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await extractPendingBookmarks({
        db,
        delayMs: 0,
        fetchPage: pageFetcher({
          [a]: () => htmlResponse(articleHtml('Epsilon')),
          [b]: () => htmlResponse(articleHtml('Zeta')),
        }),
        onItemExtracted: (id) => {
          extracted.push(id);
          throw new Error('listener boom');
        },
      });

      // Both items still settle as chunked — the throw is swallowed, not
      // reclassified as a transient item failure.
      expect(result).toEqual({
        processed: 2,
        chunkedItemIds: expect.arrayContaining([a, b]),
        noContent: 0,
        transient: 0,
      });
      expect(extracted.sort()).toEqual([a, b]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }

    expect((await getItem(a)).contentState).toBe('chunked');
    expect((await getItem(b)).contentState).toBe('chunked');
  });

  // -------------------------------------------------------------------------
  // Cooperative cancel
  // -------------------------------------------------------------------------

  it('stops between items when the signal aborts', async () => {
    const a = 'https://a.example.com/1';
    const b = 'https://b.example.com/2';
    await syncBookmarkTreeToDb(db, tree([bm(a), bm(b)]));

    const controller = new AbortController();
    const routes = pageFetcher({
      [a]: () => htmlResponse(articleHtml('A')),
      [b]: () => htmlResponse(articleHtml('B')),
    });

    const result = await extractPendingBookmarks({
      db,
      delayMs: 0,
      fetchPage: routes,
      signal: controller.signal,
      onProgress: ({ done }) => {
        if (done >= 1) controller.abort();
      },
    });

    expect(result.processed).toBe(1);
    // Exactly one item settled, the other still awaits the next run.
    const states = [(await getItem(a)).contentState, (await getItem(b)).contentState].sort();
    expect(states).toEqual(['chunked', 'pending']);
  });

  it('empty queue is a no-op', async () => {
    const fetchPage = vi.fn<BookmarkPageFetcher>();
    const result = await extractPendingBookmarks({ db, delayMs: 0, fetchPage });
    expect(result).toEqual({ processed: 0, chunkedItemIds: [], noContent: 0, transient: 0 });
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
