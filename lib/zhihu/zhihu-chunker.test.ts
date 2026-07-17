import { describe, it, expect } from 'vitest';
import { chunkZhihuMarkdown } from './zhihu-chunker';

describe('chunkZhihuMarkdown', () => {
  it('returns a single chunk for a short document', () => {
    const text = 'A short answer body.';
    expect(chunkZhihuMarkdown(text)).toEqual([{ text }]);
  });

  it('trims and returns nothing for empty / whitespace input', () => {
    expect(chunkZhihuMarkdown('')).toEqual([]);
    expect(chunkZhihuMarkdown('   \n  ')).toEqual([]);
  });

  it('prefers paragraph breaks (blank lines) at chunk boundaries', () => {
    // Paragraphs of ~290 chars: the boundary near 1500 falls inside the
    // lookback window, so the cut lands on a blank line.
    const paragraph = 'x'.repeat(280) + ' end.';
    const text = Array(10).fill(paragraph).join('\n\n'); // ~2900 chars
    const chunks = chunkZhihuMarkdown(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1500);
      // Every chunk starts at a paragraph start (never mid-paragraph).
      expect(c.text.startsWith('x')).toBe(true);
    }
  });

  it('falls back to CJK sentence punctuation when no paragraph break exists', () => {
    const sentence = '这是一个中文句子，用于测试分块！';
    const text = sentence.repeat(120); // ~1900 chars, no \n\n
    const chunks = chunkZhihuMarkdown(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
    // Sentence-preferring cut → every chunk ends on the CJK sentence end.
    for (const c of chunks.slice(0, -1)) expect(c.text.endsWith('！')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('hard-splits when no break exists in the window', () => {
    const text = 'a'.repeat(4000);
    const chunks = chunkZhihuMarkdown(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  it('carries no timestamps (text content → NULL start/end columns)', () => {
    const chunks = chunkZhihuMarkdown('short');
    expect(chunks[0].startSec).toBeUndefined();
    expect(chunks[0].endSec).toBeUndefined();
  });
});
