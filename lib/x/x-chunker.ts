/**
 * Tweet content-type chunker. Mirrors `lib/embedding/chunker.ts`'s role
 * (`chunkSubtitleRows`) but for tweet text: produces `ChunkInput[]` (the single
 * chunker↔indexing contract) with no timestamps (image/text content → NULL
 * start/end columns).
 *
 * Normal tweets are one chunk. Long premium ("note") tweets can exceed the
 * embedding provider's token limit, so this char-splits on a soft ceiling,
 * preferring sentence-ending punctuation near the boundary. Pure + unit-tested.
 */

import type { ChunkInput } from '@/lib/embedding';

/** Soft target — most premium tweets fit in one chunk well under this. */
const MAX_CHARS = 1500;
/** Look back this far from the hard boundary for a sentence break. */
const SENTENCE_LOOKBACK = 300;
/** Sentence-ending punctuation (CJK + ASCII, matches subtitle chunker set). */
const SENTENCE_END = /[。.!?！？;；…\n]/;

export function chunkTweetText(text: string): ChunkInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHARS) return [{ text: trimmed }];

  const chunks: ChunkInput[] = [];
  let rest = trimmed;

  while (rest.length > MAX_CHARS) {
    // Prefer a sentence break within [MAX_CHARS - LOOKBACK, MAX_CHARS].
    let cut = -1;
    const windowStart = Math.max(0, MAX_CHARS - SENTENCE_LOOKBACK);
    for (let i = MAX_CHARS - 1; i >= windowStart; i--) {
      if (SENTENCE_END.test(rest[i])) {
        cut = i + 1; // include the punctuation
        break;
      }
    }
    if (cut <= 0) cut = MAX_CHARS; // hard split — no sentence break found

    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push({ text: piece });
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push({ text: rest });
  return chunks;
}
