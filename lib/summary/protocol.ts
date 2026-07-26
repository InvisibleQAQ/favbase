/**
 * Output-protocol decoding for the merged summary + segments response.
 *
 * Everything here is a pure function over the raw model text, so the whole
 * fragile surface (missing tags, code fences, invented line numbers) is unit
 * testable without touching an LLM.
 *
 * Deliberately NOT ported from Bilitato's `resultNormalize.js`: it fuzzy-matches
 * ~20 possible key spellings because it lets the model free-form its JSON. Our
 * prompt pins the field names and Zod validates them — unknown shapes are
 * dropped, not guessed.
 */

import { z } from 'zod';
import type { SubtitleRow } from '@/lib/subtitle/types';
import { PROTOCOL_TAGS } from './prompt';
import type { SegmentType, VideoSegment } from './types';

/** Longest chapter title we keep — anything longer is a summary, not a label. */
const MAX_SEGMENT_TITLE_CHARS = 60;

/**
 * Slice the text between two protocol tags.
 * `endTag` absent (still streaming, or the model forgot it) → everything after
 * `startTag`. `startTag` absent → null, so callers can pick a fallback.
 */
export function extractSection(text: string, startTag: string, endTag: string): string | null {
  const startIdx = text.indexOf(startTag);
  if (startIdx === -1) return null;
  const from = startIdx + startTag.length;
  const endIdx = text.indexOf(endTag, from);
  return (endIdx === -1 ? text.slice(from) : text.slice(from, endIdx)).trim();
}

/**
 * Summary text for display, tolerant of partial streams.
 *
 * Fallback path matters: a model that ignores the protocol and just writes
 * Markdown still renders — we only cut at the SEGMENTS tag so raw JSON never
 * leaks into the prose.
 */
export function parseSummarySection(text: string): string {
  const tagged = extractSection(text, PROTOCOL_TAGS.summaryStart, PROTOCOL_TAGS.summaryEnd);
  if (tagged !== null) return tagged;

  const segmentsIdx = text.indexOf(PROTOCOL_TAGS.segmentsStart);
  const body = segmentsIdx === -1 ? text : text.slice(0, segmentsIdx);
  return stripDanglingTag(body).trim();
}

/**
 * Drop a half-streamed protocol tag at the tail (`<<<SUMM`) so the reader never
 * sees angle-bracket noise appear and disappear mid-stream.
 */
function stripDanglingTag(text: string): string {
  const idx = text.lastIndexOf('<<<');
  if (idx === -1) return text;
  const tail = text.slice(idx);
  const isCompleteTag = tail.includes('>>>');
  return isCompleteTag ? text : text.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

const rawSegmentSchema = z.object({
  start_line: z.coerce.number().int(),
  end_line: z.coerce.number().int(),
  title: z.string().trim().min(1),
  type: z.string().optional(),
});

/** Tolerate ```json fences and stray prose around the array. */
function extractJsonArray(raw: string): unknown[] | null {
  const unfenced = raw.replace(/```(?:json)?/gi, '').trim();
  const start = unfenced.indexOf('[');
  const end = unfenced.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const parsed: unknown = JSON.parse(unfenced.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function normalizeType(raw: string | undefined): SegmentType {
  const value = (raw ?? '').toLowerCase();
  return value === 'ad' || value.includes('广告') ? 'ad' : 'content';
}

/**
 * Decode the SEGMENTS block and map line numbers back to real seconds.
 *
 * `start_line` outside the transcript is a hallucination → the segment is
 * dropped. `end_line` past the last line is the common off-by-a-bit case →
 * clamped, since the intent (runs to the end) is unambiguous.
 */
export function parseSegments(text: string, rows: SubtitleRow[]): VideoSegment[] {
  if (rows.length === 0) return [];

  const section = extractSection(text, PROTOCOL_TAGS.segmentsStart, PROTOCOL_TAGS.segmentsEnd);
  const items = extractJsonArray(section ?? text);
  if (!items) return [];

  const segments: VideoSegment[] = [];
  for (const item of items) {
    const parsed = rawSegmentSchema.safeParse(item);
    if (!parsed.success) continue;

    const { start_line: startLine, end_line: endLine, title, type } = parsed.data;
    if (startLine < 1 || startLine > rows.length) continue;

    const startIdx = startLine - 1;
    const endIdx = Math.min(Math.max(endLine, startLine), rows.length) - 1;
    const start = rows[startIdx].start;
    const end = rows[endIdx].end;
    if (!(end > start)) continue;

    segments.push({
      start,
      end,
      title: title.slice(0, MAX_SEGMENT_TITLE_CHARS),
      type: normalizeType(type),
    });
  }

  return segments.sort((a, b) => a.start - b.start);
}
