import type { SubtitleRow } from '@/lib/subtitle/types';

/**
 * Raw subtitle item — either Bilibili API format (from/to/content)
 * or favbase internal format (start/end/text).
 */
interface RawItem {
  from?: number;
  to?: number;
  content?: string;
  start?: number;
  end?: number;
  text?: string;
}

/**
 * Four-step subtitle processing pipeline, ported from Bilitato's subtitleProcessor.js.
 *
 * 1. Normalize: full-width -> half-width, strip bracketed annotations
 * 2. Filter: drop short lines (<2 chars), drop interaction keywords, preserve factual lines
 * 3. Filler removal: drop pure filler-word lines, trim leading fillers
 * 4. Deduplicate: bi-gram Jaccard > 0.85 adjacent merge, keep longer text
 *
 * Accepts both Bilibili raw format ({from, to, content}) and favbase format ({start, end, text}).
 */
export function processSubtitles(raw: RawItem[]): SubtitleRow[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];

  const normalized = raw.map(normalizeItem).filter(isValid);
  return removeDuplicates(normalized);
}

// ---------------------------------------------------------------------------
// Step 1: Normalize
// ---------------------------------------------------------------------------

interface NormalizedItem {
  start: number;
  end: number;
  text: string;
}

function normalizeItem(item: RawItem): NormalizedItem {
  let text = item.text ?? item.content ?? '';

  // Full-width ASCII (U+FF01..U+FF5E) -> half-width (U+0021..U+007E)
  text = text.replace(/[！-～]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  // Ideographic space -> ASCII space
  text = text.replace(/　/g, ' ');
  // Strip bracketed annotations: [xxx] (xxx) (xxx) [xxx]
  text = text.replace(/(\[.*?\]|\(.*?\)|（.*?）|【.*?】)/g, '');
  // Collapse whitespace
  text = text.trim().replace(/\s+/g, ' ');

  return {
    start: item.from ?? item.start ?? 0,
    end: item.to ?? item.end ?? 0,
    text,
  };
}

// ---------------------------------------------------------------------------
// Step 2+3: Filter + Filler removal
// ---------------------------------------------------------------------------

const INTERACTION_KEYWORDS = [
  '点赞', '投币', '关注', '转发', '收藏',
  '评论区', '一键三连', '弹幕', '订阅',
];

const FILLERS = [
  '嗯', '啊', '呃', '额', '那个', '这个', '就是', '其实',
  '然后', '所以', '你知道', '我跟你讲', '怎么说呢', '基本上',
  '的话', '那么',
];

function isValid(item: NormalizedItem): boolean {
  if (item.text.length < 2) return false;

  // Factual lines (contain numbers/dates/percentages) are always preserved
  if (/\d+|%|元|年|月|日/.test(item.text)) return true;

  // Drop lines containing interaction keywords
  if (INTERACTION_KEYWORDS.some((kw) => item.text.includes(kw))) return false;

  // Drop pure filler-word lines
  if (FILLERS.includes(item.text)) return false;

  // Trim leading filler words
  let text = item.text;
  for (const f of FILLERS) {
    if (text.startsWith(f)) {
      text = text.slice(f.length).trim();
    }
  }
  item.text = text;

  return text.length >= 2;
}

// ---------------------------------------------------------------------------
// Step 4: Deduplicate adjacent (bi-gram Jaccard)
// ---------------------------------------------------------------------------

function getBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) {
    grams.add(text.slice(i, i + 2));
  }
  return grams;
}

function jaccard(a: string, b: string): number {
  const g1 = getBigrams(a);
  const g2 = getBigrams(b);
  if (g1.size === 0 || g2.size === 0) return 0;

  let intersectionSize = 0;
  for (const gram of g1) {
    if (g2.has(gram)) intersectionSize++;
  }
  const unionSize = new Set([...g1, ...g2]).size;
  return intersectionSize / unionSize;
}

function removeDuplicates(items: SubtitleRow[]): SubtitleRow[] {
  if (items.length < 2) return items;

  const result: SubtitleRow[] = [items[0]];

  for (let i = 1; i < items.length; i++) {
    const prev = result[result.length - 1];
    const curr = items[i];

    if (jaccard(prev.text, curr.text) > 0.85) {
      // Keep the longer text
      if (curr.text.length > prev.text.length) {
        result[result.length - 1] = curr;
      }
    } else {
      result.push(curr);
    }
  }

  return result;
}
