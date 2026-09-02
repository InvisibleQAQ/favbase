import { describe, expect, it } from 'vitest';

import { isNavItemActive } from './nav-active';

// Replaces `layouts/nav-active.test.ts` (docs/25 Step 4): the ported nav asks
// the question per row instead of resolving a sibling set, so the cases that
// used to prove "longest prefix wins" now prove segment-boundary matching and
// the deepMatch switch.

describe('isNavItemActive', () => {
  it('matches the row for its own route', () => {
    expect(isNavItemActive('/collections/bilibili', '/collections/bilibili')).toBe(true);
  });

  it('keeps a platform leaf active on its detail route when deepMatch is on', () => {
    expect(isNavItemActive('/collections/bilibili/123', '/collections/bilibili', true)).toBe(true);
  });

  it('stays inactive on a detail route without deepMatch', () => {
    expect(isNavItemActive('/collections/bilibili/123', '/collections/bilibili')).toBe(false);
  });

  it('keeps sibling leaves mutually exclusive', () => {
    expect(isNavItemActive('/collections/github', '/collections/bilibili', true)).toBe(false);
  });

  it('does not match partial path segments', () => {
    expect(isNavItemActive('/collectionsfoo', '/collections', true)).toBe(false);
  });

  it('keeps the root route exact even with deepMatch', () => {
    expect(isNavItemActive('/collections', '/', true)).toBe(false);
    expect(isNavItemActive('/', '/', true)).toBe(true);
  });

  it('never matches an outbound URL', () => {
    expect(
      isNavItemActive('/collections', 'https://github.com/owner/repo/issues/new?title=x', true),
    ).toBe(false);
  });

  it('ignores a trailing slash on either side', () => {
    expect(isNavItemActive('/collections/', '/collections')).toBe(true);
    expect(isNavItemActive('/collections', '/collections/')).toBe(true);
  });
});
