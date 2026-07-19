import { describe, it, expect } from 'vitest';
import { charSplit } from './char-split';

describe('charSplit', () => {
  it('returns [] for empty / whitespace input', () => {
    expect(charSplit('')).toEqual([]);
    expect(charSplit('   \n  ')).toEqual([]);
  });

  it('returns a single trimmed chunk for short text (no timestamps)', () => {
    const chunks = charSplit('  A short body.\nWith a second line.  ');
    expect(chunks).toEqual([{ text: 'A short body.\nWith a second line.' }]);
    expect(chunks[0].startSec).toBeUndefined();
    expect(chunks[0].endSec).toBeUndefined();
  });

  // --- preferParagraph: false (tweet-style, sentence break only) ---

  it('splits long text preferring sentence breaks', () => {
    const sentence = 'This is one sentence that adds up. ';
    const text = sentence.repeat(60); // ~2100 chars
    const chunks = charSplit(text, { preferParagraph: false });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
    const joined = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
    expect(joined).toBe(text.replace(/\s+/g, ' ').trim());
    expect(chunks[0].startSec).toBeUndefined();
  });

  it('does NOT cut on paragraph breaks when preferParagraph is false', () => {
    // A blank line sits inside the lookback window; with paragraph preference
    // off, the cut must land on the sentence end, not the blank line.
    const head = 'x'.repeat(1200) + '. ';
    const text = head + '\n\n' + 'y'.repeat(400) + '.';
    const chunks = charSplit(text, { preferParagraph: false });
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk ends at the sentence punctuation, before the blank line.
    expect(chunks[0].text.endsWith('.')).toBe(true);
    expect(chunks[0].text.includes('\n\n')).toBe(false);
  });

  // --- preferParagraph: true (markdown / description, paragraph-aware) ---

  it('prefers paragraph breaks (blank lines) at chunk boundaries', () => {
    const paragraph = 'x'.repeat(280) + ' end.';
    const text = Array(10).fill(paragraph).join('\n\n'); // ~2900 chars
    const chunks = charSplit(text, { preferParagraph: true });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1500);
      expect(c.text.startsWith('x')).toBe(true); // never mid-paragraph
    }
  });

  it('splits a two-paragraph body exactly on the blank line', () => {
    const para1 = 'First paragraph. '.repeat(83).trim(); // 1410 chars
    const para2 = 'Second paragraph content here. '.repeat(4).trim(); // ~123 chars
    const chunks = charSplit(`${para1}\n\n${para2}`, { preferParagraph: true });

    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toBe(para1);
    expect(chunks[1].text).toBe(para2);
  });

  it('falls back to CJK sentence punctuation when no paragraph break exists', () => {
    const sentence = '这是一个中文句子，用于测试分块！';
    const text = sentence.repeat(120); // ~1900 chars, no \n\n
    const chunks = charSplit(text, { preferParagraph: true });

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
    for (const c of chunks.slice(0, -1)) expect(c.text.endsWith('！')).toBe(true);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });

  // --- shared: hard split, content preservation ---

  it('hard-splits break-less text and loses no content', () => {
    const text = 'a'.repeat(4000);
    for (const preferParagraph of [true, false]) {
      const chunks = charSplit(text, { preferParagraph });
      expect(chunks.length).toBeGreaterThan(1);
      for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
      expect(chunks.map((c) => c.text).join('')).toBe(text);
    }
  });

  it('defaults preferParagraph to false', () => {
    const head = 'x'.repeat(1200) + '. ';
    const text = head + '\n\n' + 'y'.repeat(400) + '.';
    expect(charSplit(text)).toEqual(charSplit(text, { preferParagraph: false }));
  });
});
