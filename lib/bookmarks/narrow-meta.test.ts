import { describe, it, expect } from 'vitest';

import { narrowBookmarkMeta } from './bookmarks-sync-service';

const PUBLISHED_AT = new Date('2026-03-04T05:06:07Z');
const FALLBACK = { authorName: 'example.com', publishedAt: PUBLISHED_AT };

describe('narrowBookmarkMeta', () => {
  it('falls back to the row columns for empty / non-object meta', () => {
    const expected = { domain: 'example.com', dateAdded: PUBLISHED_AT.getTime() };
    expect(narrowBookmarkMeta(undefined, FALLBACK)).toEqual(expected);
    expect(narrowBookmarkMeta(null, FALLBACK)).toEqual(expected);
    expect(narrowBookmarkMeta('nope', FALLBACK)).toEqual(expected);
    expect(narrowBookmarkMeta(42, FALLBACK)).toEqual(expected);
  });

  it('reads dateAdded as null when publishedAt is null too', () => {
    expect(narrowBookmarkMeta({}, { authorName: 'example.com', publishedAt: null })).toEqual({
      domain: 'example.com',
      dateAdded: null,
    });
  });

  it('passes through a well-formed meta', () => {
    const meta = { domain: 'docs.example.org', dateAdded: 1_700_000_000_000 };
    expect(narrowBookmarkMeta(meta, FALLBACK)).toEqual(meta);
  });

  it('drops mistyped fields to the row fallbacks', () => {
    expect(narrowBookmarkMeta({ domain: 7, dateAdded: '1700000000000' }, FALLBACK)).toEqual({
      domain: 'example.com',
      dateAdded: PUBLISHED_AT.getTime(),
    });
  });
});
