import { describe, it, expect } from 'vitest';
import { chunkTweetText } from './x-chunker';

describe('chunkTweetText', () => {
  it('returns a single chunk for a normal tweet', () => {
    const text = 'Just a normal tweet with some content.';
    expect(chunkTweetText(text)).toEqual([{ text }]);
  });

  it('trims and returns nothing for empty / whitespace input', () => {
    expect(chunkTweetText('')).toEqual([]);
    expect(chunkTweetText('   \n  ')).toEqual([]);
  });

  it('trims surrounding whitespace of a single chunk', () => {
    expect(chunkTweetText('  hello  ')).toEqual([{ text: 'hello' }]);
  });

  it('splits a long premium tweet into multiple chunks preferring sentence breaks', () => {
    // Build a >MAX_CHARS (1500) note tweet made of sentences.
    const sentence = 'This is one sentence that adds up. ';
    const text = sentence.repeat(60); // ~2100 chars
    const chunks = chunkTweetText(text);

    expect(chunks.length).toBeGreaterThan(1);
    // No chunk exceeds the hard ceiling.
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
    // Reassembling (ignoring whitespace) preserves all sentence content.
    const joined = chunks.map((c) => c.text).join(' ').replace(/\s+/g, ' ').trim();
    expect(joined).toBe(text.replace(/\s+/g, ' ').trim());
    // Chunks carry no timestamps (image/text content → NULL columns).
    expect(chunks[0].startSec).toBeUndefined();
    expect(chunks[0].endSec).toBeUndefined();
  });

  it('hard-splits when no sentence break exists in the window', () => {
    const text = 'a'.repeat(4000); // no punctuation at all
    const chunks = chunkTweetText(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(1500);
    expect(chunks.map((c) => c.text).join('')).toBe(text);
  });
});
