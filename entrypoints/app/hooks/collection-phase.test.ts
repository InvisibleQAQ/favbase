import { describe, it, expect } from 'vitest';

import { resolveCollectionPhase, type CollectionPhaseInput } from './collection-phase';

/** All flags off → the terminal 'grid' phase. */
const base: CollectionPhaseInput = {
  tagFiltered: false,
  queryError: false,
  authFailed: false,
  syncErrorEmpty: false,
  metaLoading: false,
  syncingEmpty: false,
  libraryEmpty: false,
  loading: false,
  noMatches: false,
};

describe('resolveCollectionPhase', () => {
  it('falls through to grid when every flag is off', () => {
    expect(resolveCollectionPhase(base)).toBe('grid');
  });

  // Each flag, in isolation, produces its phase.
  it.each([
    ['tagFiltered', 'tag-filtered'],
    ['queryError', 'query-error'],
    ['authFailed', 'auth-failed'],
    ['syncErrorEmpty', 'sync-error'],
    ['metaLoading', 'skeleton'],
    ['syncingEmpty', 'skeleton'],
    ['libraryEmpty', 'empty-library'],
    ['loading', 'skeleton'],
    ['noMatches', 'no-matches'],
  ] as const)('maps %s → %s in isolation', (flag, phase) => {
    expect(resolveCollectionPhase({ ...base, [flag]: true })).toBe(phase);
  });

  // The ladder is a strict priority order: a higher branch wins even when every
  // lower flag is also set. Reordering the resolver breaks these.
  it('honors the full priority ladder', () => {
    const all: CollectionPhaseInput = {
      tagFiltered: true,
      queryError: true,
      authFailed: true,
      syncErrorEmpty: true,
      metaLoading: true,
      syncingEmpty: true,
      libraryEmpty: true,
      loading: true,
      noMatches: true,
    };
    expect(resolveCollectionPhase(all)).toBe('tag-filtered');
    expect(resolveCollectionPhase({ ...all, tagFiltered: false })).toBe('query-error');
    expect(resolveCollectionPhase({ ...all, tagFiltered: false, queryError: false })).toBe(
      'auth-failed',
    );
    expect(
      resolveCollectionPhase({ ...all, tagFiltered: false, queryError: false, authFailed: false }),
    ).toBe('sync-error');
    expect(
      resolveCollectionPhase({
        ...all,
        tagFiltered: false,
        queryError: false,
        authFailed: false,
        syncErrorEmpty: false,
      }),
    ).toBe('skeleton');
    // With meta/syncing loading cleared, an empty library beats the page-loading skeleton.
    expect(
      resolveCollectionPhase({
        ...all,
        tagFiltered: false,
        queryError: false,
        authFailed: false,
        syncErrorEmpty: false,
        metaLoading: false,
        syncingEmpty: false,
      }),
    ).toBe('empty-library');
    // Non-empty library, page query in flight → skeleton again (the second skeleton branch).
    expect(
      resolveCollectionPhase({
        ...all,
        tagFiltered: false,
        queryError: false,
        authFailed: false,
        syncErrorEmpty: false,
        metaLoading: false,
        syncingEmpty: false,
        libraryEmpty: false,
      }),
    ).toBe('skeleton');
    // Library non-empty, not loading, current page empty → no-matches.
    expect(resolveCollectionPhase({ ...base, noMatches: true })).toBe('no-matches');
  });

  it('auth-failed short-circuits an otherwise-empty library (the silent-bug guard)', () => {
    // A platform that drops the authFailed branch would fall to empty-library.
    expect(
      resolveCollectionPhase({ ...base, authFailed: true, libraryEmpty: true }),
    ).toBe('auth-failed');
  });
});
