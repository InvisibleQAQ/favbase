import { describe, it, expect, vi } from 'vitest';

// Defensive (mirrors zhihu-sync-service.test.ts): the storage barrel touches
// chrome.runtime at load time when pulled in transitively via @/lib/tagging.
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn().mockResolvedValue({}) },
}));

import { narrowZhihuMeta } from './zhihu-sync-service';

const fb = { authorName: 'RowAuthor' };

describe('narrowZhihuMeta', () => {
  it('returns safe defaults (type=answer, authorName=fallback) for empty meta', () => {
    expect(narrowZhihuMeta(undefined, fb)).toEqual({
      type: 'answer',
      excerpt: '',
      authorName: 'RowAuthor',
      avatarUrl: null,
      thumbnailUrl: null,
      collectionTitle: '',
    });
  });

  it('passes through a well-formed meta', () => {
    const meta = {
      type: 'article' as const,
      excerpt: 'hi',
      authorName: 'Meta Author',
      avatarUrl: 'https://a/x.png',
      thumbnailUrl: 'https://t/y.png',
      collectionTitle: 'My Fav',
    };
    expect(narrowZhihuMeta(meta, fb)).toEqual(meta);
  });

  it('rejects an unknown type to answer', () => {
    expect(narrowZhihuMeta({ type: 'bogus' }, fb).type).toBe('answer');
  });

  it('keeps an empty-string authorName; only a non-string falls back', () => {
    expect(narrowZhihuMeta({ authorName: '' }, fb).authorName).toBe('');
    expect(narrowZhihuMeta({ authorName: 42 }, fb).authorName).toBe('RowAuthor');
  });

  it('treats empty-string avatar/thumbnail as absent (null)', () => {
    const n = narrowZhihuMeta({ avatarUrl: '', thumbnailUrl: '' }, fb);
    expect(n.avatarUrl).toBeNull();
    expect(n.thumbnailUrl).toBeNull();
  });
});
