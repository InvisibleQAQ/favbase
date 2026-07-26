import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from './rrf';

describe('reciprocalRankFusion', () => {
  it('returns [] for empty input', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('scores a single list by 1/(k+rank)', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c']], { k: 60 });
    expect(fused.map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(fused[0].score).toBeCloseTo(1 / 61, 10);
    expect(fused[1].score).toBeCloseTo(1 / 62, 10);
    expect(fused[2].score).toBeCloseTo(1 / 63, 10);
  });

  it('adds scores across lists for overlapping ids', () => {
    // 'b' is rank1 in list2 and rank2 in list1 -> highest fused score.
    const fused = reciprocalRankFusion(
      [
        ['a', 'b', 'c'],
        ['b', 'd'],
      ],
      { k: 60 },
    );
    const byId = Object.fromEntries(fused.map((f) => [f.id, f.score]));
    expect(byId.b).toBeCloseTo(1 / 62 + 1 / 61, 10);
    expect(byId.a).toBeCloseTo(1 / 61, 10);
    expect(byId.d).toBeCloseTo(1 / 62, 10);
    // 'b' ranks first overall.
    expect(fused[0].id).toBe('b');
  });

  it('breaks score ties deterministically by id ascending', () => {
    // 'x' and 'y' both appear only at rank1 of one list -> equal score.
    const fused = reciprocalRankFusion([['y'], ['x']]);
    expect(fused.map((f) => f.id)).toEqual(['x', 'y']);
    expect(fused[0].score).toBeCloseTo(fused[1].score, 10);
  });

  it('k changes the score magnitude (smaller k = sharper)', () => {
    const small = reciprocalRankFusion([['a']], { k: 1 })[0].score;
    const large = reciprocalRankFusion([['a']], { k: 60 })[0].score;
    expect(small).toBeCloseTo(1 / 2, 10);
    expect(large).toBeCloseTo(1 / 61, 10);
    expect(small).toBeGreaterThan(large);
  });

  it('truncates to topK', () => {
    const fused = reciprocalRankFusion([['a', 'b', 'c', 'd']], { topK: 2 });
    expect(fused).toHaveLength(2);
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('counts a repeated id within one list only once (first occurrence rank)', () => {
    const fused = reciprocalRankFusion([['a', 'a', 'b']], { k: 60 });
    const byId = Object.fromEntries(fused.map((f) => [f.id, f.score]));
    // 'a' scored at rank1 only, not rank1+rank2.
    expect(byId.a).toBeCloseTo(1 / 61, 10);
    // 'b' is at index 2 -> rank3.
    expect(byId.b).toBeCloseTo(1 / 63, 10);
  });
});
