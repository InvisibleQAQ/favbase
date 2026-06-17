import { describe, it, expect, beforeEach } from 'vitest';
import { resolvePageMeta } from '../effects';

describe('resolvePageMeta', () => {
  beforeEach(() => {
    delete (window as any).__INITIAL_STATE__;
    delete (window as any).__playinfo__;
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
    expect(meta.cid).toBe(0);
  });

  it('extracts cid from __playinfo__', () => {
    (window as any).__playinfo__ = { data: { bvid: 'BVplay', cid: 99999 } };
    const meta = resolvePageMeta();
    expect(meta.bvid).toBe('BVplay');
    expect(meta.cid).toBe(99999);
  });
});
