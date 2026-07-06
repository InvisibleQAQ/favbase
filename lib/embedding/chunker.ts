import type { SubtitleRow } from '@/lib/subtitle/types';
import type { ChunkInput } from './types';

/**
 * Subtitle chunker: line-level greedy packing (research Option B).
 *
 * A `SubtitleRow` is the atomic unit — lines are never split mid-line (Whisper
 * segments / official CC lines are natural pause boundaries), except for the
 * rare single line longer than `maxChars` which falls back to punctuation-then
 * character hard-splitting. Both official and ASR subtitles flow through the
 * same path: punctuation is a bonus closing signal, never a requirement.
 */

export interface ChunkerOptions {
  /** Start looking for a closing point once the chunk reaches this many chars. */
  targetChars?: number;
  /** Hard upper bound — close immediately once reached. */
  maxChars?: number;
  /** A trailing chunk smaller than this merges into the previous chunk. */
  minChars?: number;
  /** Inter-row silence (seconds) treated as a pause boundary. */
  gapSeconds?: number;
  /** Overlap line longer than this is not carried into the next chunk. */
  maxOverlapChars?: number;
}

const DEFAULT_OPTIONS: Required<ChunkerOptions> = {
  targetChars: 500,
  maxChars: 700,
  minChars: 100,
  gapSeconds: 2,
  maxOverlapChars: 150,
};

/**
 * Sentence-final punctuation. MUST cover both CJK and ASCII variants:
 * subtitle normalization folds fullwidth `！？；` to halfwidth `!?;` but `。`
 * (U+3002) is outside the fullwidth-ASCII range and survives as-is
 * (subtitle-processor.ts). The double coverage is load-bearing.
 */
const SENTENCE_END = new Set(['。', '.', '!', '?', '！', '？', ';', '；', '…']);

function endsWithSentencePunct(text: string): boolean {
  return text.length > 0 && SENTENCE_END.has(text[text.length - 1]);
}

interface Unit {
  text: string;
  start: number;
  end: number;
}

interface Line extends Unit {
  /** True when this line was carried over from the previous chunk. */
  overlap: boolean;
}

/**
 * Fallback for a single row longer than `maxChars`: split by sentence-final
 * punctuation first, then hard-slice any remaining oversized sentence. All
 * pieces share the row's time span (per-piece interpolation is not worth the
 * complexity for this rare case).
 */
function splitOversizedRow(row: Unit, maxChars: number): Unit[] {
  const sentences: string[] = [];
  let buf = '';
  for (const ch of row.text) {
    buf += ch;
    if (SENTENCE_END.has(ch)) {
      sentences.push(buf);
      buf = '';
    }
  }
  if (buf) sentences.push(buf);

  const pieces: string[] = [];
  let acc = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (acc) {
        pieces.push(acc);
        acc = '';
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if (acc.length + sentence.length > maxChars) {
      pieces.push(acc);
      acc = sentence;
    } else {
      acc += sentence;
    }
  }
  if (acc) pieces.push(acc);

  return pieces.map((text) => ({ text, start: row.start, end: row.end }));
}

/**
 * Pack subtitle rows into `ChunkInput[]`:
 *
 * 1. Accumulate rows joined by `\n` (the `item_contents.plain_text` convention).
 * 2. Once ≥ `targetChars`, close at the first line ending in sentence-final
 *    punctuation OR followed by a ≥ `gapSeconds` pause; hard-close at `maxChars`.
 * 3. The next chunk starts with the previous chunk's last line (1-line overlap),
 *    skipped when that line exceeds `maxOverlapChars`.
 * 4. A trailing fragment with < `minChars` of fresh text merges into the
 *    previous chunk (overlap line excluded to avoid duplication).
 *
 * `startSec` = first line start, `endSec` = last line end. Empty input → `[]`.
 */
export function chunkSubtitleRows(
  rows: SubtitleRow[],
  options?: ChunkerOptions,
): ChunkInput[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const units: Unit[] = [];
  for (const row of rows) {
    const text = row.text?.trim();
    if (!text) continue;
    const unit = { text, start: row.start, end: row.end };
    if (text.length > opts.maxChars) units.push(...splitOversizedRow(unit, opts.maxChars));
    else units.push(unit);
  }
  if (units.length === 0) return [];

  const chunks: ChunkInput[] = [];
  let lines: Line[] = [];
  let chars = 0; // length of lines joined by '\n'

  const addLine = (line: Line): void => {
    chars += (lines.length > 0 ? 1 : 0) + line.text.length;
    lines.push(line);
  };

  const closeChunk = (): void => {
    if (lines.length === 0) return;
    chunks.push({
      text: lines.map((l) => l.text).join('\n'),
      startSec: lines[0].start,
      endSec: lines[lines.length - 1].end,
    });
    const last = lines[lines.length - 1];
    lines = [];
    chars = 0;
    if (last.text.length <= opts.maxOverlapChars) {
      addLine({ ...last, overlap: true });
    }
  };

  for (let i = 0; i < units.length; i++) {
    addLine({ ...units[i], overlap: false });

    if (chars >= opts.maxChars) {
      closeChunk();
      continue;
    }

    const next = units[i + 1];
    if (!next) break;

    if (chars >= opts.targetChars) {
      const gap = next.start - units[i].end;
      if (endsWithSentencePunct(units[i].text) || gap >= opts.gapSeconds) {
        closeChunk();
      }
    }
  }

  // Tail: only fresh (non-overlap) lines carry new information. A pure-overlap
  // leftover is dropped; a small fresh tail merges into the previous chunk.
  const freshLines = lines.filter((l) => !l.overlap);
  if (freshLines.length > 0) {
    const freshText = freshLines.map((l) => l.text).join('\n');
    if (freshText.length < opts.minChars && chunks.length > 0) {
      const prev = chunks[chunks.length - 1];
      chunks[chunks.length - 1] = {
        text: `${prev.text}\n${freshText}`,
        startSec: prev.startSec,
        endSec: freshLines[freshLines.length - 1].end,
      };
    } else {
      chunks.push({
        text: lines.map((l) => l.text).join('\n'),
        startSec: lines[0].start,
        endSec: lines[lines.length - 1].end,
      });
    }
  }

  return chunks;
}
