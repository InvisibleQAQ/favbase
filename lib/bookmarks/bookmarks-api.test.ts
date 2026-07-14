import { describe, it, expect, vi } from 'vitest';

// bookmarks-api imports `browser` from 'wxt/browser' at module top; the pure
// functions under test never touch it. Mock it away so the test never depends
// on an extension runtime.
vi.mock('wxt/browser', () => ({ browser: {} }));

import {
  normalizeUrl,
  isHttpUrl,
  extractDomain,
  flattenBookmarkTree,
  type RawBookmarkNode,
} from './bookmarks-api';

describe('normalizeUrl', () => {
  it('lowercases the host and keeps path/case-sensitive query', () => {
    expect(normalizeUrl('https://GitHub.COM/kepano/Defuddle')).toBe(
      'https://github.com/kepano/Defuddle',
    );
  });

  it('strips utm_* and common click-tracking params', () => {
    expect(
      normalizeUrl('https://example.com/post?utm_source=x&utm_medium=y&id=42&fbclid=abc&ref=z'),
    ).toBe('https://example.com/post?id=42');
  });

  it('drops a trailing slash on non-root paths but keeps the root slash', () => {
    expect(normalizeUrl('https://example.com/foo/bar/')).toBe('https://example.com/foo/bar');
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com/');
  });

  it('collapses two URLs differing only by tracking params to the same key', () => {
    const a = normalizeUrl('https://example.com/x?utm_campaign=a');
    const b = normalizeUrl('https://example.com/x/?gclid=b');
    expect(a).toBe(b);
  });

  it('falls back to the trimmed raw string for unparseable input', () => {
    expect(normalizeUrl('  not a url  ')).toBe('not a url');
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isHttpUrl('http://a.com')).toBe(true);
    expect(isHttpUrl('https://a.com')).toBe(true);
  });

  it('rejects non-http schemes and garbage', () => {
    expect(isHttpUrl('javascript:void(0)')).toBe(false);
    expect(isHttpUrl('chrome://bookmarks')).toBe(false);
    expect(isHttpUrl('file:///c:/x.html')).toBe(false);
    expect(isHttpUrl('place:folder=1')).toBe(false);
    expect(isHttpUrl('not-a-url')).toBe(false);
  });
});

describe('extractDomain', () => {
  it('returns the host without a leading www', () => {
    expect(extractDomain('https://www.github.com/x')).toBe('github.com');
    expect(extractDomain('https://news.ycombinator.com/item?id=1')).toBe('news.ycombinator.com');
  });
  it('returns empty string for garbage', () => {
    expect(extractDomain('javascript:0')).toBe('');
  });
});

describe('flattenBookmarkTree', () => {
  // getTree() shape: a synthetic root ('0') whose children are the top-level
  // containers (Bookmarks Bar '1', Other '2').
  const tree: RawBookmarkNode[] = [
    {
      id: '0',
      title: '',
      children: [
        {
          id: '1',
          title: 'Bookmarks Bar',
          children: [
            { id: '10', title: 'GitHub', url: 'https://github.com', dateAdded: 1000 },
            {
              id: '11',
              title: 'Tech',
              children: [
                { id: '110', title: 'Web', url: 'https://web.dev/', dateAdded: 2000 },
                // non-http bookmark — must be filtered out
                { id: '111', title: 'JS Bookmarklet', url: 'javascript:void(0)', dateAdded: 3000 },
              ],
            },
            // empty folder — appears in folders but no bookmarks reference it
            { id: '12', title: 'Empty', children: [] },
          ],
        },
        {
          id: '2',
          title: 'Other Bookmarks',
          children: [{ id: '20', title: 'Untitled', url: 'https://example.com/a' }],
        },
      ],
    },
  ];

  const { folders, bookmarks } = flattenBookmarkTree(tree);

  it('lists every folder with a full path, skipping the synthetic root', () => {
    expect(folders.map((f) => f.id)).toEqual(['1', '11', '12', '2']);
    const byId = Object.fromEntries(folders.map((f) => [f.id, f]));
    expect(byId['1'].path).toBe('Bookmarks Bar');
    expect(byId['11'].path).toBe('Bookmarks Bar/Tech');
    expect(byId['2'].path).toBe('Other Bookmarks');
  });

  it('filters non-http bookmarks and assigns each to its immediate parent folder', () => {
    expect(bookmarks.map((b) => b.url)).toEqual([
      'https://github.com',
      'https://web.dev/',
      'https://example.com/a',
    ]);
    const byUrl = Object.fromEntries(bookmarks.map((b) => [b.url, b]));
    expect(byUrl['https://github.com'].folderId).toBe('1');
    expect(byUrl['https://web.dev/'].folderId).toBe('11');
    expect(byUrl['https://example.com/a'].folderId).toBe('2');
  });

  it('normalizes url + domain and defaults dateAdded/title', () => {
    const web = bookmarks.find((b) => b.url === 'https://web.dev/')!;
    // Root path — URL always keeps the trailing slash, so it stays as-is.
    expect(web.normalizedUrl).toBe('https://web.dev/');
    expect(web.domain).toBe('web.dev');
    expect(web.dateAdded).toBe(2000);

    // missing dateAdded → 0; title falls back to url when empty
    const other = bookmarks.find((b) => b.url === 'https://example.com/a')!;
    expect(other.dateAdded).toBe(0);
  });
});
