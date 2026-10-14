/**
 * Word segmentation for the chunk keyword index (`item_chunk_terms`).
 *
 * PGlite has full-text search (`to_tsvector`, GIN, `phraseto_tsquery`) but no
 * Chinese parser: its default parser keeps an unspaced CJK run as one token.
 * So segmentation happens here, in JS, and SQL only ever sees text that is
 * already split into words. The index side (`replaceItemChunks`, the v008
 * backfill) and the query side (the Chat keyword arm) must both go through
 * `segmentWords`, or index-time and query-time lexemes stop agreeing.
 *
 * Leaf on purpose, with zero imports: it is reached from the Background
 * Service Worker (Chat retrieval), the Offscreen document (chunk writer and
 * migration) and Node tests.
 */

/**
 * The text-search configuration for `to_tsvector` / `phraseto_tsquery` on both
 * sides. `simple` lowercases and does nothing else: no stemming, no stopword
 * list, so CJK words pass through unchanged.
 */
export const TEXT_SEARCH_CONFIG = 'simple';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/**
 * The word-like segments of `text`, joined by single spaces. Punctuation and
 * whitespace segments are dropped. ICU splits Latin from CJK even without a
 * space, and falls back to single characters for words outside its
 * dictionary (`编程` → `编 程`), consistently in every context. Pure.
 */
export function segmentWords(text: string): string {
  const words: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike) words.push(segment);
  }
  return words.join(' ');
}
