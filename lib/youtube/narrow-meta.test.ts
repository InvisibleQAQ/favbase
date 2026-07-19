import { describe, it, expect, vi } from 'vitest';

// Defensive (mirrors youtube-sync-service.test.ts): the storage barrel touches
// chrome.runtime at load time when pulled in transitively via @/lib/tagging.
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn().mockResolvedValue({}) },
}));

import { narrowYoutubeMeta } from './youtube-sync-service';

const fb = { authorName: 'Channel Fallback' };

describe('narrowYoutubeMeta', () => {
  it('returns safe defaults (channelTitle=fallback) for empty meta', () => {
    expect(narrowYoutubeMeta(undefined, fb)).toEqual({
      channelId: '',
      channelTitle: 'Channel Fallback',
      thumbnailUrl: null,
      durationSeconds: 0,
      viewCount: 0,
      likeCount: 0,
      description: '',
      addedAt: null,
      videoPublishedAt: null,
    });
  });

  it('passes through a well-formed meta', () => {
    const meta = {
      channelId: 'UC123',
      channelTitle: 'Real Channel',
      thumbnailUrl: 'https://t/x.jpg',
      durationSeconds: 212,
      viewCount: 1000,
      likeCount: 42,
      description: 'desc',
      addedAt: '2026-01-01T00:00:00Z',
      videoPublishedAt: '2025-12-01T00:00:00Z',
    };
    expect(narrowYoutubeMeta(meta, fb)).toEqual(meta);
  });

  it('falls back an empty-string OR non-string channelTitle to authorName', () => {
    expect(narrowYoutubeMeta({ channelTitle: '' }, fb).channelTitle).toBe('Channel Fallback');
    expect(narrowYoutubeMeta({ channelTitle: 7 }, fb).channelTitle).toBe('Channel Fallback');
  });

  it('treats empty-string thumbnail/addedAt/videoPublishedAt as absent (null)', () => {
    const n = narrowYoutubeMeta({ thumbnailUrl: '', addedAt: '', videoPublishedAt: '' }, fb);
    expect(n.thumbnailUrl).toBeNull();
    expect(n.addedAt).toBeNull();
    expect(n.videoPublishedAt).toBeNull();
  });

  it('drops malformed numeric fields to 0', () => {
    const n = narrowYoutubeMeta({ durationSeconds: '5', viewCount: null, likeCount: {} }, fb);
    expect(n).toMatchObject({ durationSeconds: 0, viewCount: 0, likeCount: 0 });
  });
});
