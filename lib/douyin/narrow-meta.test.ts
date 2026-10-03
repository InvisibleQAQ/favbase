import { describe, it, expect } from 'vitest';

// No storage mock: the service's load graph is storage-free by contract
// (tests/lib-import-smoke.test.ts).
import { narrowDouyinMeta, toDouyinItem } from './douyin-sync-service';

const fb = { title: 'Row Title', authorName: 'Row Author' };

describe('narrowDouyinMeta', () => {
  it('returns safe defaults (desc=title, authorName=fallback) for empty meta', () => {
    expect(narrowDouyinMeta(undefined, fb)).toEqual({
      desc: 'Row Title',
      authorName: 'Row Author',
      authorSecUid: '',
      avatarUrl: null,
      coverUrl: null,
      durationMs: null,
      mediaKind: 'video',
      folderId: null,
      folderTitle: null,
    });
  });

  it('passes through a well-formed meta', () => {
    const meta = {
      desc: 'a desc #tag',
      authorName: 'Meta Author',
      authorSecUid: 'MS4wLjABAAAA_x',
      avatarUrl: 'https://p3/a.jpeg',
      coverUrl: 'https://p3/c.jpeg',
      durationMs: 15_300,
      mediaKind: 'note' as const,
      folderId: '6910000000000000202',
      folderTitle: 'Public',
    };
    expect(narrowDouyinMeta(meta, fb)).toEqual(meta);
  });

  it('keeps an empty-string desc / authorName; only a non-string falls back', () => {
    expect(narrowDouyinMeta({ desc: '', authorName: '' }, fb)).toMatchObject({
      desc: '',
      authorName: '',
    });
    expect(narrowDouyinMeta({ desc: 7, authorName: null }, fb)).toMatchObject({
      desc: 'Row Title',
      authorName: 'Row Author',
    });
  });

  it('rejects wrongly typed fields to their defaults', () => {
    expect(
      narrowDouyinMeta(
        {
          authorSecUid: 5,
          avatarUrl: '',
          coverUrl: 42,
          durationMs: '15300',
          mediaKind: 'live',
          folderId: 6910000000000000202,
          folderTitle: '',
        },
        fb,
      ),
    ).toMatchObject({
      authorSecUid: '',
      avatarUrl: null,
      coverUrl: null,
      durationMs: null,
      mediaKind: 'video',
      folderId: null,
      folderTitle: null,
    });
  });

  it('drops a non-positive or non-finite duration', () => {
    expect(narrowDouyinMeta({ durationMs: 0 }, fb).durationMs).toBeNull();
    expect(narrowDouyinMeta({ durationMs: -1 }, fb).durationMs).toBeNull();
    expect(narrowDouyinMeta({ durationMs: Number.NaN }, fb).durationMs).toBeNull();
  });
});

describe('toDouyinItem', () => {
  it('assembles the envelope from the row and the rest from the meta', () => {
    const publishedAt = new Date(1_758_000_000_000);
    expect(
      toDouyinItem({
        id: 'uuid-1',
        platformItemId: '7300000000000000001',
        title: 'first line',
        authorName: 'Alice',
        originalUrl: 'https://www.douyin.com/video/7300000000000000001',
        publishedAt,
        platformMeta: { desc: 'first line\nsecond', mediaKind: 'video', durationMs: 9_000 },
      }),
    ).toEqual({
      id: 'uuid-1',
      awemeId: '7300000000000000001',
      title: 'first line',
      originalUrl: 'https://www.douyin.com/video/7300000000000000001',
      publishedAt,
      desc: 'first line\nsecond',
      authorName: 'Alice',
      authorSecUid: '',
      avatarUrl: null,
      coverUrl: null,
      durationMs: 9_000,
      mediaKind: 'video',
      folderId: null,
      folderTitle: null,
    });
  });
});
