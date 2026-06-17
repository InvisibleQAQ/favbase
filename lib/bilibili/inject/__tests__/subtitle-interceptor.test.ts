import { describe, it, expect, beforeEach } from 'vitest';
import { isSubtitleRequest, resolvePageMeta } from '../subtitle-interceptor';

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

describe('resolvePageMeta', () => {
  beforeEach(() => {
    delete (window as any).__INITIAL_STATE__;
    delete (window as any).__playinfo__;
    // Set a bilibili-like URL for extractBvid to work
    Object.defineProperty(window, 'location', {
      value: { href: 'https://www.bilibili.com/video/BV1test123' },
      writable: true,
      configurable: true,
    });
  });

  it('extracts bvid from __INITIAL_STATE__', () => {
    (window as any).__INITIAL_STATE__ = { bvid: 'BVfromState' };
    const meta = resolvePageMeta();
    expect(meta.bvid).toBe('BVfromState');
  });

  it('extracts bvid from videoData', () => {
    (window as any).__INITIAL_STATE__ = { videoData: { bvid: 'BVvideoData', cid: 12345 } };
    const meta = resolvePageMeta();
    expect(meta.bvid).toBe('BVvideoData');
    expect(meta.cid).toBe(12345);
  });

  it('falls back to URL bvid when no global state', () => {
    const meta = resolvePageMeta();
    expect(meta.bvid).toBe('BV1test123');
  });

  it('returns cid=0 when no cid available', () => {
    (window as any).__INITIAL_STATE__ = { bvid: 'BVnoCid' };
    const meta = resolvePageMeta();
    expect(meta.cid).toBe(0);
  });

  it('handles NaN cid gracefully', () => {
    (window as any).__INITIAL_STATE__ = { videoData: { bvid: 'BVtest', cid: 'not-a-number' } };
    const meta = resolvePageMeta();
    // NaN is not finite, so falls through to getCidFromPages and then 0
    expect(meta.cid).toBe(0);
  });

  it('extracts cid from __playinfo__', () => {
    (window as any).__playinfo__ = { data: { bvid: 'BVplay', cid: 99999 } };
    const meta = resolvePageMeta();
    expect(meta.bvid).toBe('BVplay');
    expect(meta.cid).toBe(99999);
  });
});
