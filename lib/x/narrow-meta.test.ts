import { describe, it, expect } from 'vitest';

// No storage mock: the service's load graph is storage-free by contract
// (tests/lib-import-smoke.test.ts).
import { narrowXMeta } from './x-sync-service';

const fb = { title: 'Row Title', authorName: 'Row Author' };

describe('narrowXMeta', () => {
  it('returns safe defaults (text=title, authorName=fallback) for empty meta', () => {
    expect(narrowXMeta(undefined, fb)).toEqual({
      text: 'Row Title',
      authorName: 'Row Author',
      authorHandle: '',
      avatarUrl: null,
      media: [],
      likeCount: 0,
      retweetCount: 0,
      replyCount: 0,
      lang: '',
    });
  });

  it('passes through a well-formed meta', () => {
    const meta = {
      text: 'a tweet',
      authorName: 'Meta Author',
      authorHandle: 'handle',
      avatarUrl: 'https://a/x.png',
      media: [{ type: 'photo', url: 'https://m/1.jpg' }],
      likeCount: 5,
      retweetCount: 2,
      replyCount: 1,
      lang: 'en',
    };
    expect(narrowXMeta(meta, fb)).toEqual(meta);
  });

  it('keeps an empty-string text / authorName; only a non-string falls back', () => {
    expect(narrowXMeta({ text: '', authorName: '' }, fb)).toMatchObject({
      text: '',
      authorName: '',
    });
    expect(narrowXMeta({ text: 9, authorName: null }, fb)).toMatchObject({
      text: 'Row Title',
      authorName: 'Row Author',
    });
  });

  it('filters malformed media entries (safer than the old Array.isArray passthrough)', () => {
    const n = narrowXMeta(
      {
        media: [
          { type: 'photo', url: 'https://ok/1.jpg' },
          { type: 'video' }, // missing url
          { url: 'https://no-type/2.jpg' }, // missing type
          null,
          'garbage',
          { type: 1, url: 2 }, // wrong types
        ],
      },
      fb,
    );
    expect(n.media).toEqual([{ type: 'photo', url: 'https://ok/1.jpg' }]);
  });

  it('returns [] media when meta.media is not an array', () => {
    expect(narrowXMeta({ media: 'nope' }, fb).media).toEqual([]);
  });
});
