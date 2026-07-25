import { describe, expect, it } from 'vitest';

import type { UsedTag } from '@/lib/tagging';
import {
  resolveCollectionTagFilter,
  updateCollectionTagParams,
} from './collection-tag-filter';

const knownId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const usedTags: UsedTag[] = [
  { id: knownId, name: 'frontend', count: 3 },
  { id: otherId, name: 'saved', count: 1 },
];

describe('collection tag URL state', () => {
  it('accepts exactly one currently used UUID', () => {
    expect(resolveCollectionTagFilter([knownId], usedTags)).toEqual({
      tagId: knownId,
      shouldClean: false,
    });
  });

  it('resolves an uppercase UUID to the canonical used-tag id', () => {
    const canonicalId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(
      resolveCollectionTagFilter(
        [canonicalId.toUpperCase()],
        [{ id: canonicalId, name: 'canonical', count: 1 }],
      ),
    ).toEqual({ tagId: canonicalId, shouldClean: false });
  });

  it.each([
    [['not-a-uuid'], 'malformed'],
    [['33333333-3333-4333-8333-333333333333'], 'unknown'],
    [[knownId, knownId], 'duplicate'],
    [[knownId, otherId], 'multiple'],
  ])('ignores and cleans %s tag values (%s)', (values) => {
    expect(resolveCollectionTagFilter(values, usedTags)).toEqual({
      tagId: null,
      shouldClean: true,
    });
  });

  it('replaces or clears tag while preserving unrelated params', () => {
    const initial = new URLSearchParams(`search=react&tag=${knownId}&tag=${otherId}`);

    const replaced = updateCollectionTagParams(initial, otherId);
    expect(replaced.getAll('tag')).toEqual([otherId]);
    expect(replaced.get('search')).toBe('react');

    const cleared = updateCollectionTagParams(replaced, null);
    expect(cleared.has('tag')).toBe(false);
    expect(cleared.get('search')).toBe('react');
  });
});
