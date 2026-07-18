import { describe, it, expect } from 'vitest';
import { chunkDescription } from './youtube-chunker';

describe('chunkDescription', () => {
  it('returns [] for empty / whitespace input', () => {
    expect(chunkDescription('')).toEqual([]);
    expect(chunkDescription('   \n  ')).toEqual([]);
  });

  it('keeps a normal description as one trimmed chunk without timestamps', () => {
    const chunks = chunkDescription('  A short video description.\nWith a second line.  ');
    expect(chunks).toEqual([{ text: 'A short video description.\nWith a second line.' }]);
    expect(chunks[0].startSec).toBeUndefined();
    expect(chunks[0].endSec).toBeUndefined();
  });

  it('splits long descriptions preferring paragraph breaks', () => {
    // para1 ends inside the lookback window (1200..1500); total > 1500 forces a split.
    const para1 = 'First paragraph. '.repeat(83).trim(); // 1410 chars
    const para2 = 'Second paragraph content here. '.repeat(4).trim(); // ~123 chars
    const chunks = chunkDescription(`${para1}\n\n${para2}`);

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe(para1);
    expect(chunks[1].text).toBe(para2);
  });

  it('hard-splits break-less text and loses no content', () => {
    const text = 'x'.repeat(4000);
    const chunks = chunkDescription(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 1500)).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });
});
