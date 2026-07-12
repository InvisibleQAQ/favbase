import { describe, it, expect } from 'vitest';
import { parseLinkHeader } from './github-api';

// ---------------------------------------------------------------------------
// parseLinkHeader — pure function over the GitHub Link response header.
// First page of a multi-page listing carries rel="next" + rel="last";
// a single-page listing has no Link header at all.
// ---------------------------------------------------------------------------

describe('parseLinkHeader', () => {
  it('extracts the rel="last" page number from a first-page header', () => {
    const header =
      '<https://api.github.com/user/starred?per_page=100&sort=created&direction=desc&page=2>; rel="next", ' +
      '<https://api.github.com/user/starred?per_page=100&sort=created&direction=desc&page=12>; rel="last"';
    expect(parseLinkHeader(header)).toBe(12);
  });

  it('returns null when the header is absent (single page)', () => {
    expect(parseLinkHeader(null)).toBeNull();
  });

  it('returns null when no rel="last" is present (already on last page)', () => {
    const header =
      '<https://api.github.com/user/starred?page=11>; rel="prev", ' +
      '<https://api.github.com/user/starred?page=1>; rel="first"';
    expect(parseLinkHeader(header)).toBeNull();
  });

  it('returns null for a malformed header', () => {
    expect(parseLinkHeader('total garbage')).toBeNull();
    expect(parseLinkHeader('<not-a-url>; rel="last"')).toBeNull();
  });

  it('returns null when the last URL has no valid page param', () => {
    expect(parseLinkHeader('<https://api.github.com/user/starred>; rel="last"')).toBeNull();
    expect(
      parseLinkHeader('<https://api.github.com/user/starred?page=abc>; rel="last"'),
    ).toBeNull();
  });

  it('handles rel="last" appearing before rel="next"', () => {
    const header =
      '<https://api.github.com/user/starred?page=5>; rel="last", ' +
      '<https://api.github.com/user/starred?page=2>; rel="next"';
    expect(parseLinkHeader(header)).toBe(5);
  });
});
