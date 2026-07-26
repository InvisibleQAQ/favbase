import { describe, it, expect } from 'vitest';

import { landingHash, needsCredentials, normalizePicks } from './landing';

describe('normalizePicks', () => {
  it('sorts into registry order regardless of click order', () => {
    expect(normalizePicks(['youtube', 'bilibili', 'x'])).toEqual(['bilibili', 'x', 'youtube']);
  });

  it('de-duplicates repeated picks', () => {
    expect(normalizePicks(['github', 'github'])).toEqual(['github']);
  });

  it('returns an empty array for no picks', () => {
    expect(normalizePicks([])).toEqual([]);
  });
});

describe('needsCredentials', () => {
  it('flags the token/key platforms', () => {
    expect(needsCredentials('github')).toBe(true);
    expect(needsCredentials('youtube')).toBe(true);
  });

  it('leaves login-state and local platforms alone', () => {
    expect(needsCredentials('bilibili')).toBe(false);
    expect(needsCredentials('zhihu')).toBe(false);
    expect(needsCredentials('x')).toBe(false);
    expect(needsCredentials('bookmarks')).toBe(false);
  });
});

describe('landingHash', () => {
  it('lands on the dashboard when nothing is picked', () => {
    expect(landingHash([])).toBe('');
  });

  it('lands on settings when the first pick needs a credential', () => {
    expect(landingHash(['github'])).toBe('#/settings');
    expect(landingHash(['youtube'])).toBe('#/settings');
  });

  it('lands on the collection page of a ready platform', () => {
    expect(landingHash(['bookmarks'])).toBe('#/collections/bookmarks');
  });

  it('uses registry order, not click order, to choose the destination', () => {
    expect(landingHash(['github', 'bilibili'])).toBe('#/collections/bilibili');
    expect(landingHash(['youtube', 'github'])).toBe('#/settings');
  });
});
