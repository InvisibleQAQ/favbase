/**
 * YouTube description chunker. Mirrors `lib/zhihu/zhihu-chunker.ts`'s role
 * (produces `ChunkInput[]`, the single chunker↔indexing contract) for video
 * descriptions: plain text that is usually short but can run to several
 * thousand chars (chapters, links, sponsor blocks). Paragraph-aware split —
 * preference order at each boundary is blank line (paragraph break) →
 * sentence-ending punctuation (CJK + ASCII) → hard cut. No timestamps (text
 * content → NULL start/end columns). Pure + unit-tested.
 */

import type { ChunkInput } from '@/lib/embedding';

/** Soft target per chunk — comfortably under embedding provider token limits. */
const MAX_CHARS = 1500;
/** Look back this far from the hard boundary for a paragraph/sentence break. */
const LOOKBACK = 300;
/** Sentence-ending punctuation (CJK + ASCII, matches the x/zhihu chunker set). */
const SENTENCE_END = /[。.!?！？;；…\n]/;

/** Best cut position within (0, limit], or -1 when no break exists in the window. */
function findCut(text: string, limit: number): number {
  const windowStart = Math.max(0, limit - LOOKBACK);

  // 1st preference: paragraph break (blank line) — descriptions are line-heavy.
  const paragraphCut = text.lastIndexOf('\n\n', limit - 1);
  if (paragraphCut >= windowStart && paragraphCut > 0) return paragraphCut + 2;

  // 2nd preference: sentence end.
  for (let i = limit - 1; i >= windowStart; i--) {
    if (SENTENCE_END.test(text[i])) return i + 1; // include the punctuation
  }
  return -1;
}

export function chunkDescription(text: string): ChunkInput[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= MAX_CHARS) return [{ text: trimmed }];

  const chunks: ChunkInput[] = [];
  let rest = trimmed;

  while (rest.length > MAX_CHARS) {
    let cut = findCut(rest, MAX_CHARS);
    if (cut <= 0) cut = MAX_CHARS; // hard split — no break found in the window

    const piece = rest.slice(0, cut).trim();
    if (piece) chunks.push({ text: piece });
    rest = rest.slice(cut).trim();
  }

  if (rest) chunks.push({ text: rest });
  return chunks;
}
