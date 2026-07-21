import { describe, expect, it } from 'vitest';

import { bookmarkDisplayName } from './bookmark-display';

describe('bookmarkDisplayName', () => {
  it('uses the trimmed bookmark title when present', () => {
    expect(bookmarkDisplayName('  Saved title  ', 'https://example.com/post')).toBe('Saved title');
  });

  it('falls back to hostname and then the raw URL', () => {
    expect(bookmarkDisplayName(' ', 'https://docs.example.com/post')).toBe('docs.example.com');
    expect(bookmarkDisplayName('', 'not a valid URL')).toBe('not a valid URL');
  });
});
