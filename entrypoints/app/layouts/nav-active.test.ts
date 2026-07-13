import { describe, expect, it } from 'vitest';
import { findActiveChildPath } from './nav-active';

const PATHS = ['/collections', '/collections/github'];

describe('findActiveChildPath', () => {
  it('resolves /collections to the bilibili leaf', () => {
    expect(findActiveChildPath('/collections', PATHS)).toBe('/collections');
  });

  it('resolves /collections/bilibili/:id to the bilibili leaf', () => {
    expect(findActiveChildPath('/collections/bilibili/123', PATHS)).toBe('/collections');
  });

  it('resolves /collections/github to the github leaf only (regression: bilibili mis-highlight)', () => {
    expect(findActiveChildPath('/collections/github', PATHS)).toBe('/collections/github');
  });

  it('resolves nested github routes to the github leaf', () => {
    expect(findActiveChildPath('/collections/github/x', PATHS)).toBe('/collections/github');
  });

  it('returns null when nothing matches', () => {
    expect(findActiveChildPath('/settings', PATHS)).toBeNull();
  });

  it('does not match partial path segments', () => {
    expect(findActiveChildPath('/collectionsfoo', PATHS)).toBeNull();
  });

  it('is order-independent (longest prefix wins regardless of declaration order)', () => {
    expect(findActiveChildPath('/collections/github', [...PATHS].reverse())).toBe(
      '/collections/github',
    );
  });
});
