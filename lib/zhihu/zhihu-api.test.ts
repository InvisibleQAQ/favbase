import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  buildCollectionItemsUrl,
  fetchCollectionItems,
  mapCollection,
  mapCollectionItem,
  stripHtmlToText,
  type ZhihuCollection,
} from './zhihu-api';

// ---------------------------------------------------------------------------
// Fixtures — minimal slices of the v4 collections/items response shapes.
// ---------------------------------------------------------------------------

const COLLECTION: ZhihuCollection = { id: 'c1', title: 'My Favorites' };

const AUTHOR = {
  id: 'a_alice',
  name: 'Alice',
  avatar_url: 'https://pic1.zhimg.com/alice.jpg',
};

function answerItem(overrides: Record<string, unknown> = {}) {
  return {
    content: {
      type: 'answer',
      id: 123,
      question: { id: 456, title: 'How to test?' },
      url: 'https://www.zhihu.com/question/456/answer/123',
      content: '<p>Full answer <b>HTML</b></p>',
      excerpt: 'Full answer HTML',
      author: AUTHOR,
      updated_time: 1700000000,
      ...overrides,
    },
  };
}

describe('buildCollectionItemsUrl', () => {
  it('builds the v4 items URL with offset/limit', () => {
    expect(buildCollectionItemsUrl('987', 40)).toBe(
      'https://www.zhihu.com/api/v4/collections/987/items?offset=40&limit=20',
    );
  });
});

describe('stripHtmlToText', () => {
  it('strips tags, decodes entities and collapses whitespace', () => {
    expect(stripHtmlToText('<p>a &amp; b</p>\n<div> c&nbsp;d </div>')).toBe('a & b c d');
  });
});

describe('mapCollection', () => {
  it('maps id/title and stringifies numeric ids', () => {
    expect(mapCollection({ id: 42, title: 'Tech' })).toEqual({ id: '42', title: 'Tech' });
  });

  it('drops rows without an id', () => {
    expect(mapCollection({ title: 'no id' })).toBeNull();
    expect(mapCollection(null)).toBeNull();
  });

  it('filters explicitly private collections (is_public false / 0)', () => {
    expect(mapCollection({ id: 1, title: 'p', is_public: false })).toBeNull();
    expect(mapCollection({ id: 2, title: 'p', is_public: 0 })).toBeNull();
    // Defensive default: unknown / missing field = public.
    expect(mapCollection({ id: 3, title: 'p' })).not.toBeNull();
    expect(mapCollection({ id: 4, title: 'p', is_public: true })).not.toBeNull();
  });
});

describe('mapCollectionItem', () => {
  it('maps an answer: question title, canonical URL, HTML body, updated_time', () => {
    const row = mapCollectionItem(answerItem(), COLLECTION);
    expect(row).toEqual({
      type: 'answer',
      id: '123',
      title: 'How to test?',
      url: 'https://www.zhihu.com/question/456/answer/123',
      contentHtml: '<p>Full answer <b>HTML</b></p>',
      excerpt: 'Full answer HTML',
      author: { id: 'a_alice', name: 'Alice', avatarUrl: 'https://pic1.zhimg.com/alice.jpg' },
      createdAt: 1700000000,
      thumbnailUrl: null,
      collectionId: 'c1',
      collectionTitle: 'My Favorites',
    });
  });

  it('answer without question falls back to raw url and excerpt title', () => {
    const row = mapCollectionItem(
      answerItem({ question: undefined, excerpt: 'short excerpt' }),
      COLLECTION,
    );
    expect(row?.title).toBe('short excerpt');
    expect(row?.url).toBe('https://www.zhihu.com/question/456/answer/123');
  });

  it('maps an article: title, zhuanlan URL, cover, updated', () => {
    const row = mapCollectionItem(
      {
        content: {
          type: 'article',
          id: 777,
          title: 'An Article',
          content: '<p>article body</p>',
          excerpt: 'article body',
          image_url: 'https://pic2.zhimg.com/cover.jpg',
          author: AUTHOR,
          updated: 1690000000,
        },
      },
      COLLECTION,
    );
    expect(row).toMatchObject({
      type: 'article',
      title: 'An Article',
      url: 'https://zhuanlan.zhihu.com/p/777',
      contentHtml: '<p>article body</p>',
      thumbnailUrl: 'https://pic2.zhimg.com/cover.jpg',
      createdAt: 1690000000,
    });
  });

  it('maps a pin: assembles segments, derives title/thumbnail, pin URL', () => {
    const row = mapCollectionItem(
      {
        content: {
          type: 'pin',
          id: 'p1',
          excerpt_title: '',
          created: 1680000000,
          author: AUTHOR,
          content: [
            { type: 'text', content: '<div>想法正文。第二句。</div>' },
            { type: 'image', url: 'https://pic3.zhimg.com/photo_720w.jpg' },
            { type: 'link', url: 'https://example.com', title: 'A link' },
            { type: 'unknown-segment' },
          ],
        },
      },
      COLLECTION,
    );
    expect(row?.type).toBe('pin');
    // No excerpt_title → derived from the assembled segments' text.
    expect(row?.title).toBe('想法正文。第二句。 A link');
    expect(row?.url).toBe('https://www.zhihu.com/pin/p1');
    // Image size suffix stripped; segments joined in order.
    expect(row?.contentHtml).toBe(
      '<div>想法正文。第二句。</div>\n<img src="https://pic3.zhimg.com/photo.jpg">\n<p><a href="https://example.com">A link</a></p>',
    );
    expect(row?.thumbnailUrl).toBe('https://pic3.zhimg.com/photo.jpg');
    expect(row?.createdAt).toBe(1680000000);
  });

  it('maps a zvideo: no body (cover only)', () => {
    const row = mapCollectionItem(
      {
        content: {
          type: 'zvideo',
          id: 999,
          title: 'A Video',
          url: 'https://www.zhihu.com/zvideo/999',
          video: { url: 'https://pic4.zhimg.com/cover.jpg' },
          author: AUTHOR,
          updated_time: 1670000000,
        },
      },
      COLLECTION,
    );
    expect(row).toMatchObject({
      type: 'zvideo',
      title: 'A Video',
      contentHtml: null,
      thumbnailUrl: 'https://pic4.zhimg.com/cover.jpg',
      url: 'https://www.zhihu.com/zvideo/999',
    });
  });

  it('falls back to an anonymous author when author data is missing', () => {
    const row = mapCollectionItem(answerItem({ author: undefined }), COLLECTION);
    expect(row?.author).toEqual({ id: 'anonymous', name: 'anonymous', avatarUrl: '' });
  });

  it('returns null for unknown types, missing content and missing ids', () => {
    expect(mapCollectionItem({ content: { type: 'question', id: 1 } }, COLLECTION)).toBeNull();
    expect(mapCollectionItem({}, COLLECTION)).toBeNull();
    expect(mapCollectionItem(null, COLLECTION)).toBeNull();
    expect(mapCollectionItem({ content: { type: 'answer' } }, COLLECTION)).toBeNull();
  });
});

describe('fetchCollectionItems cooperative control', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks control before claiming each page', async () => {
    vi.useFakeTimers();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [answerItem()],
            paging: { is_end: false, totals: 40 },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [], paging: { is_end: true, totals: 40 } }), {
          status: 200,
        }),
      );
    const checkpoint = vi.fn(async () => {});

    const run = fetchCollectionItems(COLLECTION, undefined, { checkpoint });
    await vi.runAllTimersAsync();
    await run;

    expect(checkpoint).toHaveBeenCalledTimes(2);
  });
});
