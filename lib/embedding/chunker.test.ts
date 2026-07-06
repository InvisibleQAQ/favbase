import { describe, it, expect } from 'vitest';
import type { SubtitleRow } from '@/lib/subtitle/types';
import { chunkSubtitleRows, type ChunkerOptions } from './chunker';

function row(text: string, start: number, end: number): SubtitleRow {
  return { start, end, text };
}

/** Small numbers keep fixtures readable; the algorithm is size-agnostic. */
const base: ChunkerOptions = {
  targetChars: 10,
  maxChars: 100,
  minChars: 2,
  gapSeconds: 100, // effectively disable gap closure unless a test opts in
  maxOverlapChars: 0, // effectively disable overlap unless a test opts in
};

describe('chunkSubtitleRows — empty / degenerate input', () => {
  it('returns [] for empty input', () => {
    expect(chunkSubtitleRows([])).toEqual([]);
  });

  it('returns [] when all rows are blank', () => {
    expect(chunkSubtitleRows([row('', 0, 1), row('   ', 1, 2)])).toEqual([]);
  });
});

describe('chunkSubtitleRows — sentence-final punctuation closure', () => {
  it('closes on Chinese 。 once target is reached', () => {
    const chunks = chunkSubtitleRows(
      [
        row('这是第一句话。', 0, 2), // 7 chars < target
        row('这是第二句话。', 2, 4), // joined 15 >= target, ends 。 → close
        row('结尾片段啊', 4, 5),
      ],
      base,
    );

    expect(chunks.map((c) => c.text)).toEqual([
      '这是第一句话。\n这是第二句话。',
      '结尾片段啊',
    ]);
    expect(chunks[0].startSec).toBe(0);
    expect(chunks[0].endSec).toBe(4);
    expect(chunks[1].startSec).toBe(4);
    expect(chunks[1].endSec).toBe(5);
  });

  it('closes on ASCII . once target is reached', () => {
    const chunks = chunkSubtitleRows(
      [
        row('hello world.', 0, 2), // 12 >= target, ends . → close
        row('second part.', 2, 4),
        row('tail', 4, 5),
      ],
      base,
    );

    expect(chunks.map((c) => c.text)).toEqual([
      'hello world.',
      'second part.',
      'tail',
    ]);
  });

  it('does NOT close at target without punctuation or gap', () => {
    const chunks = chunkSubtitleRows(
      [row('aaaa', 0, 1), row('bbbb', 1, 2), row('cccc', 2, 3)],
      { ...base, targetChars: 5, maxChars: 20, minChars: 1 },
    );

    // 9 chars >= target after row 2, but no punct and no gap → keeps eating.
    expect(chunks.map((c) => c.text)).toEqual(['aaaa\nbbbb\ncccc']);
  });
});

describe('chunkSubtitleRows — pause (gap) closure', () => {
  it('closes when the inter-row gap reaches gapSeconds', () => {
    const chunks = chunkSubtitleRows(
      [row('aaaa', 0, 1), row('bbbb', 1, 2), row('cccc', 5, 6)], // gap 5-2=3 >= 2
      { ...base, targetChars: 5, gapSeconds: 2 },
    );

    expect(chunks.map((c) => c.text)).toEqual(['aaaa\nbbbb', 'cccc']);
    expect(chunks[0].endSec).toBe(2);
    expect(chunks[1].startSec).toBe(5);
  });
});

describe('chunkSubtitleRows — overlap', () => {
  it('starts the next chunk with the previous chunk last line', () => {
    const chunks = chunkSubtitleRows(
      [row('hello.', 0, 1), row('world here', 1, 2), row('more.', 2, 3)],
      { ...base, targetChars: 5, maxOverlapChars: 150, minChars: 1 },
    );

    expect(chunks.map((c) => c.text)).toEqual([
      'hello.',
      'hello.\nworld here\nmore.',
    ]);
    // Overlap line's own start time is the chunk start.
    expect(chunks[1].startSec).toBe(0);
    expect(chunks[1].endSec).toBe(3);
  });

  it('skips the overlap line when it exceeds maxOverlapChars', () => {
    const long = `${'x'.repeat(20)}.`; // 21 chars > maxOverlapChars 10
    const chunks = chunkSubtitleRows(
      [row(long, 0, 1), row('short tail line.', 1, 2)],
      { ...base, targetChars: 5, maxOverlapChars: 10, minChars: 1 },
    );

    expect(chunks.map((c) => c.text)).toEqual([long, 'short tail line.']);
    expect(chunks[1].startSec).toBe(1);
  });
});

describe('chunkSubtitleRows — tail fragment handling', () => {
  it('merges a tail smaller than minChars into the previous chunk', () => {
    const chunks = chunkSubtitleRows(
      [row('first sentence.', 0, 2), row('tiny', 2, 3)],
      { ...base, targetChars: 5, minChars: 10 },
    );

    expect(chunks).toEqual([
      { text: 'first sentence.\ntiny', startSec: 0, endSec: 3 },
    ]);
  });

  it('merge does not duplicate the overlap line', () => {
    const chunks = chunkSubtitleRows(
      [row('first sentence.', 0, 2), row('tiny', 2, 3)],
      { ...base, targetChars: 5, minChars: 10, maxOverlapChars: 150 },
    );

    expect(chunks).toHaveLength(1);
    const occurrences = chunks[0].text.split('first sentence.').length - 1;
    expect(occurrences).toBe(1);
    expect(chunks[0].text).toBe('first sentence.\ntiny');
  });

  it('keeps a tail at or above minChars as its own chunk', () => {
    const chunks = chunkSubtitleRows(
      [row('first sentence.', 0, 2), row('long enough tail', 2, 3)],
      { ...base, targetChars: 5, minChars: 10 },
    );

    expect(chunks.map((c) => c.text)).toEqual([
      'first sentence.',
      'long enough tail',
    ]);
  });
});

describe('chunkSubtitleRows — oversized single row fallback', () => {
  it('splits by punctuation first, then hard-slices by chars', () => {
    const text = `一二三四五六七八九。${'b'.repeat(20)}`; // 30 chars, max 10
    const chunks = chunkSubtitleRows([row(text, 0, 5)], {
      ...base,
      targetChars: 10,
      maxChars: 10,
      minChars: 1,
    });

    expect(chunks.map((c) => c.text)).toEqual([
      '一二三四五六七八九。',
      'b'.repeat(10),
      'b'.repeat(10),
    ]);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(10);
      // Fallback pieces share the row's time span.
      expect(chunk.startSec).toBe(0);
      expect(chunk.endSec).toBe(5);
    }
  });
});

describe('chunkSubtitleRows — default parameters sanity', () => {
  it('packs ~500-char chunks with 1-line overlap under defaults', () => {
    // 30 rows of 50 chars each, all ending in 。 (2s apart, no long pauses).
    const line = `${'内容'.repeat(24)}好。`; // 50 chars
    const rows = Array.from({ length: 30 }, (_, i) => row(line, i * 2, i * 2 + 2));

    const chunks = chunkSubtitleRows(rows);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(700);
    }
    // Overlap: each following chunk starts with the previous chunk's last line.
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].text.startsWith(line)).toBe(true);
    }
    // Rows are never split mid-line on the normal path.
    for (const chunk of chunks) {
      for (const part of chunk.text.split('\n')) {
        expect(part).toBe(line);
      }
    }
  });
});
