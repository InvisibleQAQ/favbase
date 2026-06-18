import { describe, it, expect } from 'vitest';
import { isSubtitleCdnUrl } from '../../api';

describe('isSubtitleCdnUrl', () => {
  it('detects BFS subtitle paths', () => {
    expect(isSubtitleCdnUrl('https://aisubtitle.hdslb.com/bfs/subtitle/abc.json')).toBe(true);
    expect(isSubtitleCdnUrl('https://i0.hdslb.com/bfs/ai_subtitle/xyz.json')).toBe(true);
  });

  it('detects aisubtitle path segments', () => {
    expect(isSubtitleCdnUrl('https://cdn.hdslb.com/aisubtitle/abc.json')).toBe(true);
  });

  it('detects json subtitle paths', () => {
    expect(isSubtitleCdnUrl('https://api.bilibili.com/some/subtitle/data.json')).toBe(true);
  });

  it('rejects data.bilibili.com tracking', () => {
    expect(isSubtitleCdnUrl('https://data.bilibili.com/v/web/some')).toBe(false);
  });

  it('rejects log paths', () => {
    expect(isSubtitleCdnUrl('https://api.bilibili.com/log/web/event')).toBe(false);
  });

  it('rejects unrelated URLs', () => {
    expect(isSubtitleCdnUrl('https://api.bilibili.com/x/web-interface/view')).toBe(false);
    expect(isSubtitleCdnUrl('https://www.bilibili.com/video/BV1234')).toBe(false);
  });

  it('handles empty/invalid input', () => {
    expect(isSubtitleCdnUrl('')).toBe(false);
    expect(isSubtitleCdnUrl('not-a-url')).toBe(false);
  });
});
