import { describe, it, expect } from 'vitest';
import { chunk, escapeLike } from './sql-utils';

describe('chunk', () => {
  it('splits into fixed-size batches, last batch may be short', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns one batch when size >= length', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('returns empty for an empty array', () => {
    expect(chunk([], 500)).toEqual([]);
  });
});

describe('escapeLike', () => {
  it('escapes the three LIKE metacharacters', () => {
    expect(escapeLike('%')).toBe('\\%');
    expect(escapeLike('_')).toBe('\\_');
    expect(escapeLike('\\')).toBe('\\\\');
  });

  it('escapes the backslash before % / _ so the pattern stays literal', () => {
    // `\%` from user input must become `\\\%`: an escaped backslash + escaped %.
    expect(escapeLike('\\%')).toBe('\\\\\\%');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('hello world')).toBe('hello world');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeLike('a%b%c')).toBe('a\\%b\\%c');
  });
});
