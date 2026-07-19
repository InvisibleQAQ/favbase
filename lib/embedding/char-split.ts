/**
 * Character-level soft splitter for text-native content types (tweets, zhihu
 * markdown, youtube descriptions). Produces `ChunkInput[]` (the single
 * chunker↔indexing contract) with no timestamps — text content maps to NULL
 * `start_sec`/`end_sec` columns.
 *
 * Most bodies fit in one chunk; long ones (premium "note" tweets, long answers,
 * chapter-heavy descriptions) soft-split on a char ceiling, preferring a natural
 * break near the boundary. `preferParagraph` adds a blank-line (paragraph)
 * boundary as the top preference for structured markdown/line-heavy text; tweet
 * text leaves it off (sentence break only). Pure + unit-tested.
 *
 * Distinct from `chunkSubtitleRows` (`./chunker.ts`): that packs pre-segmented
 * subtitle rows with time spans and overlap; this splits an opaque string.
 */

import type { ChunkInput } from './types';

/** Soft target per chunk — comfortably under embedding provider token limits. */
const MAX_CHARS = 1500;
/** Look back this far from the hard boundary for a paragraph/sentence break. */
const LOOKBACK = 300;
/** Sentence-ending punctuation (CJK + ASCII, matches the subtitle chunker set). */
const SENTENCE_END = /[。.!?！？;；…\n]/;

/** Best cut position within (0, limit], or -1 when no break exists in the window. */
function findCut(text: string, limit: number, preferParagraph: boolean): number {
  const windowStart = Math.max(0, limit - LOOKBACK);

  // 1st preference (structured text only): paragraph break (blank line).
  if (preferParagraph) {
    const paragraphCut = text.lastIndexOf('\n\n', limit - 1);
    if (paragraphCut >= windowStart && paragraphCut > 0) return paragraphCut + 2;
  }

  // Next preference: sentence end.
  for (let i = limit - 1; i >= windowStart; i--) {
    if (SENTENCE_END.test(text[i])) return i + 1; // include the punctuation
  }
  return -1;
}

export function charSplit(
  text: string,
  opts?: { preferParagraph?: boolean },
): ChunkInput[] {
  const preferParagraph = opts?.preferParagraph ?? false;
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHARS) return [{ text: trimmed }];

  const chunks: ChunkInput[] = [];
  let rest = trimmed;

  while (rest.length > MAX_CHARS) {
    let cut = findCut(rest, MAX_CHARS, preferParagraph);
    if (cut <= 0) cut = MAX_CHARS; // hard split — no break found in the window

    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push({ text: piece });
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push({ text: rest });
  return chunks;
}
