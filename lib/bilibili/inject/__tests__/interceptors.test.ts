import { describe, it, expect } from 'vitest';
import { isSubtitleRequest } from '../interceptors';

describe('isSubtitleRequest', () => {
  it('detects BFS subtitle paths', () => {
    expect(isSubtitleRequest('https://aisubtitle.hdslb.com/bfs/subtitle/abc.json')).toBe(true);
    expect(isSubtitleRequest('https://i0.hdslb.com/bfs/ai_subtitle/xyz.json')).toBe(true);
  });

  it('detects aisubtitle path segments', () => {
    expect(isSubtitleRequest('https://cdn.hdslb.com/aisubtitle/abc.json')).toBe(true);
  });

  it('detects json subtitle paths', () => {
    expect(isSubtitleRequest('https://api.bilibili.com/some/subtitle/data.json')).toBe(true);
  });

  it('rejects data.bilibili.com tracking', () => {
    expect(isSubtitleRequest('https://data.bilibili.com/v/web/some')).toBe(false);
  });

  it('rejects log paths', () => {
    expect(isSubtitleRequest('https://api.bilibili.com/log/web/event')).toBe(false);
  });

  it('rejects unrelated URLs', () => {
    expect(isSubtitleRequest('https://api.bilibili.com/x/web-interface/view')).toBe(false);
    expect(isSubtitleRequest('https://www.bilibili.com/video/BV1234')).toBe(false);
  });

  it('handles empty/invalid input', () => {
    expect(isSubtitleRequest('')).toBe(false);
    expect(isSubtitleRequest('not-a-url')).toBe(false);
  });
});
