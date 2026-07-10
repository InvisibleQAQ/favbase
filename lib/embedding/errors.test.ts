import { describe, expect, it } from 'vitest';
import { COMMON_EMBEDDING_DIMENSIONS, MAX_INDEXABLE_DIMENSIONS } from './errors';

describe('COMMON_EMBEDDING_DIMENSIONS — settings-page preset invariants', () => {
  it('contains only positive integers', () => {
    for (const d of COMMON_EMBEDDING_DIMENSIONS) {
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBeGreaterThan(0);
    }
  });

  it('is strictly increasing', () => {
    for (let i = 1; i < COMMON_EMBEDDING_DIMENSIONS.length; i++) {
      expect(COMMON_EMBEDDING_DIMENSIONS[i]).toBeGreaterThan(COMMON_EMBEDDING_DIMENSIONS[i - 1]);
    }
  });

  it('stays within the HNSW indexable cap', () => {
    for (const d of COMMON_EMBEDDING_DIMENSIONS) {
      expect(d).toBeLessThanOrEqual(MAX_INDEXABLE_DIMENSIONS);
    }
  });
});
