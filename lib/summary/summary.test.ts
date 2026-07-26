import { describe, expect, it } from 'vitest';
import type { SubtitleRow } from '@/lib/subtitle/types';
import {
  buildSummaryPrompt,
  formatSubtitleForPrompt,
  PROTOCOL_TAGS,
} from './prompt';
import { extractSection, parseSegments, parseSummarySection } from './protocol';

const rows: SubtitleRow[] = [
  { start: 0, end: 5, text: '大家好' },
  { start: 5, end: 12, text: '今天讲讲显卡' },
  { start: 12, end: 20, text: '先说结论' },
  { start: 20, end: 30, text: '本期由某某赞助' },
  { start: 30, end: 42, text: '好了说回正题' },
];

function wrap(summary: string, segmentsJson: string): string {
  return [
    PROTOCOL_TAGS.summaryStart,
    summary,
    PROTOCOL_TAGS.summaryEnd,
    PROTOCOL_TAGS.segmentsStart,
    segmentsJson,
    PROTOCOL_TAGS.segmentsEnd,
  ].join('\n');
}

describe('formatSubtitleForPrompt', () => {
  it('numbers lines from 1 with clock prefixes', () => {
    const text = formatSubtitleForPrompt(rows);
    expect(text.split('\n')[0]).toBe('#1 [0:00] 大家好');
    expect(text.split('\n')[4]).toBe('#5 [0:30] 好了说回正题');
  });
});

describe('buildSummaryPrompt', () => {
  const prompt = buildSummaryPrompt({ title: '显卡评测', rows });

  it('carries both protocol blocks and the line-number contract', () => {
    expect(prompt).toContain(PROTOCOL_TAGS.summaryStart);
    expect(prompt).toContain(PROTOCOL_TAGS.segmentsEnd);
    // Line ids are the only allowed anchor — the upper bound must be stated.
    expect(prompt).toContain('1 到 5');
    expect(prompt).toMatch(/json/i);
  });

  it('embeds the numbered transcript and the title', () => {
    expect(prompt).toContain('#4 [0:20] 本期由某某赞助');
    expect(prompt).toContain('显卡评测');
  });
});

describe('extractSection', () => {
  it('returns null when the start tag is absent', () => {
    expect(extractSection('plain text', PROTOCOL_TAGS.summaryStart, PROTOCOL_TAGS.summaryEnd))
      .toBeNull();
  });

  it('returns the tail when the end tag has not streamed in yet', () => {
    const partial = `${PROTOCOL_TAGS.summaryStart}\n**结论**`;
    expect(extractSection(partial, PROTOCOL_TAGS.summaryStart, PROTOCOL_TAGS.summaryEnd))
      .toBe('**结论**');
  });
});

describe('parseSummarySection', () => {
  it('extracts the tagged summary', () => {
    expect(parseSummarySection(wrap('**结论**\n- 值得买', '[]'))).toBe('**结论**\n- 值得买');
  });

  it('falls back to raw text when the model ignores the protocol', () => {
    expect(parseSummarySection('**结论**\n- 值得买')).toBe('**结论**\n- 值得买');
  });

  it('never leaks the segments block into the prose on the fallback path', () => {
    const raw = `**结论**\n${PROTOCOL_TAGS.segmentsStart}\n[{"start_line":1}]`;
    expect(parseSummarySection(raw)).toBe('**结论**');
  });

  it('hides a half-streamed protocol tag', () => {
    expect(parseSummarySection('正文<<<SUMM')).toBe('正文');
  });
});

describe('parseSegments', () => {
  it('maps line numbers to real subtitle seconds', () => {
    const raw = wrap('x', '[{"start_line":1,"end_line":3,"title":"开场","type":"content"}]');
    expect(parseSegments(raw, rows)).toEqual([
      { start: 0, end: 20, title: '开场', type: 'content' },
    ]);
  });

  it('marks ad segments and sorts by start', () => {
    const raw = wrap(
      'x',
      `[{"start_line":4,"end_line":4,"title":"广告","type":"ad"},
        {"start_line":1,"end_line":2,"title":"开场","type":"content"}]`,
    );
    const segments = parseSegments(raw, rows);
    expect(segments.map((s) => s.title)).toEqual(['开场', '广告']);
    expect(segments[1]).toMatchObject({ start: 20, end: 30, type: 'ad' });
  });

  it('drops hallucinated start lines but clamps an overshooting end line', () => {
    const raw = wrap(
      'x',
      '[{"start_line":99,"end_line":120,"title":"幻觉"},{"start_line":5,"end_line":99,"title":"结尾"}]',
    );
    expect(parseSegments(raw, rows)).toEqual([
      { start: 30, end: 42, title: '结尾', type: 'content' },
    ]);
  });

  it('survives code fences and stray prose around the array', () => {
    const raw = wrap('x', '```json\n[{"start_line":1,"end_line":2,"title":"开场"}]\n```');
    expect(parseSegments(raw, rows)).toHaveLength(1);
  });

  it('returns [] for malformed JSON or a missing block instead of throwing', () => {
    expect(parseSegments(wrap('x', '{oops'), rows)).toEqual([]);
    expect(parseSegments('just a summary', rows)).toEqual([]);
  });

  it('drops items missing required fields', () => {
    const raw = wrap('x', '[{"start_line":1,"end_line":2},{"start_line":1,"end_line":2,"title":"ok"}]');
    expect(parseSegments(raw, rows)).toHaveLength(1);
  });
});
