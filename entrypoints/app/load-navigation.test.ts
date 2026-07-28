import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getValue } = vi.hoisted(() => ({ getValue: vi.fn() }));

vi.mock('@/lib/storage', () => ({
  onboardingStorage: { getValue },
}));

import { loadNavigationData } from './load-navigation';

function platformPaths(navData: Awaited<ReturnType<typeof loadNavigationData>>) {
  return navData
    .find((item) => item.path === '/collections')
    ?.children?.filter((child) => !child.external)
    .map((child) => child.path);
}

describe('loadNavigationData', () => {
  beforeEach(() => {
    getValue.mockReset();
  });

  it('loads the onboarding preference before building navigation', async () => {
    getValue.mockResolvedValue({
      completedAt: 1,
      platforms: ['x', 'bilibili', 'github'],
    });

    expect(platformPaths(await loadNavigationData())).toEqual([
      '/collections/bilibili',
      '/collections/github',
      '/collections/x',
      '/collections/bookmarks',
      '/collections/zhihu',
      '/collections/youtube',
    ]);
  });

  it('falls back to canonical navigation when storage cannot be read', async () => {
    const error = new Error('storage unavailable');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getValue.mockRejectedValue(error);

    expect(platformPaths(await loadNavigationData())).toEqual([
      '/collections/bilibili',
      '/collections/github',
      '/collections/bookmarks',
      '/collections/x',
      '/collections/zhihu',
      '/collections/youtube',
    ]);
    expect(errorSpy).toHaveBeenCalledWith(
      '[app] failed to load onboarding navigation preference',
      error,
    );

    errorSpy.mockRestore();
  });

  it('ignores a malformed persisted platforms value', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getValue.mockResolvedValue({ completedAt: 1, platforms: 42 });

    expect(platformPaths(await loadNavigationData())).toEqual([
      '/collections/bilibili',
      '/collections/github',
      '/collections/bookmarks',
      '/collections/x',
      '/collections/zhihu',
      '/collections/youtube',
    ]);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it('ignores unknown and duplicate persisted platform entries', async () => {
    getValue.mockResolvedValue({
      completedAt: 1,
      platforms: ['youtube', 'unknown', 'youtube', 'bilibili'],
    });

    expect(platformPaths(await loadNavigationData())).toEqual([
      '/collections/bilibili',
      '/collections/youtube',
      '/collections/github',
      '/collections/bookmarks',
      '/collections/x',
      '/collections/zhihu',
    ]);
  });
});
