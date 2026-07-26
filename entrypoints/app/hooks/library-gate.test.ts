import { beforeEach, describe, expect, it, vi } from 'vitest';

import { COLLECTION_PLATFORMS, type CollectionPlatform } from '@/lib/collections/platforms';

// In-memory stand-in for the WXT storage item (chrome.storage is absent in
// vitest). Keeps getValue/setValue round-trip fidelity and exposes the watch
// callback so a cross-context update can be simulated.
const store = vi.hoisted(() => ({
  watchers: [] as ((value: string[]) => void)[],
  value: [] as string[],
}));

vi.mock('@/lib/storage', () => ({
  libraryGateStorage: {
    getValue: async () => store.value,
    setValue: async (value: string[]) => {
      store.value = value;
      for (const watcher of store.watchers) watcher(value);
    },
    watch: (cb: (value: string[]) => void) => {
      store.watchers.push(cb);
      return () => {};
    },
  },
}));

// vi.hoisted: the mock factory runs before module-level consts are initialized.
const { pauseJob, resumeJob, setJobGate } = vi.hoisted(() => ({
  pauseJob: vi.fn(),
  resumeJob: vi.fn(),
  setJobGate: vi.fn(),
}));

vi.mock('./background-jobs-store', () => ({ pauseJob, resumeJob, setJobGate }));

import {
  gatePlatformOf,
  isLibraryPaused,
  pauseLibrary,
  resumeLibrary,
} from './library-gate';

const JOB_NAMESPACES: Record<CollectionPlatform, string> = {
  bilibili: 'bilibili',
  github: 'github-stars',
  bookmarks: 'bookmarks',
  x: 'x-bookmarks',
  zhihu: 'zhihu-favorites',
  youtube: 'youtube-playlists',
};

describe('library gate', () => {
  beforeEach(async () => {
    // Module state is a singleton — clear every pause between cases.
    for (const platform of COLLECTION_PLATFORMS) await resumeLibrary(platform);
    pauseJob.mockClear();
    resumeJob.mockClear();
  });

  it('registers itself as the job dispatcher gate on module load', () => {
    expect(setJobGate).toHaveBeenCalledWith(isLibraryPaused);
  });

  it('defaults to everything running (empty paused list)', () => {
    expect(store.value).toEqual([]);
    for (const platform of COLLECTION_PLATFORMS) {
      expect(isLibraryPaused(JOB_NAMESPACES[platform])).toBe(false);
    }
  });

  it('maps every job namespace to its persisted discriminator', async () => {
    for (const platform of COLLECTION_PLATFORMS) {
      expect(gatePlatformOf(JOB_NAMESPACES[platform])).toBe(platform);

      await pauseLibrary(platform);
      expect(isLibraryPaused(JOB_NAMESPACES[platform])).toBe(true);
      await resumeLibrary(platform);
      expect(isLibraryPaused(JOB_NAMESPACES[platform])).toBe(false);
    }
  });

  it('persists the paused platform and keeps siblings running', async () => {
    await pauseLibrary('github');

    expect(store.value).toEqual(['github']);
    expect(isLibraryPaused('github-stars')).toBe(true);
    expect(isLibraryPaused('x-bookmarks')).toBe(false);

    await resumeLibrary('github');
    expect(store.value).toEqual([]);
    expect(isLibraryPaused('github-stars')).toBe(false);
  });

  it('mirrors the pause synchronously, before the write settles', () => {
    const pending = pauseLibrary('zhihu');

    expect(isLibraryPaused('zhihu-favorites')).toBe(true);
    return pending;
  });

  it('pauses and resumes every gated kind of the live run', async () => {
    await pauseLibrary('bookmarks');
    expect(pauseJob.mock.calls).toEqual([
      ['bookmarks', 'sync'],
      ['bookmarks', 'extract'],
      ['bookmarks', 'embed'],
      ['bookmarks', 'tag'],
      ['bookmarks', 'transcribe'],
    ]);

    await resumeLibrary('bookmarks');
    expect(resumeJob.mock.calls).toEqual([
      ['bookmarks', 'sync'],
      ['bookmarks', 'extract'],
      ['bookmarks', 'embed'],
      ['bookmarks', 'tag'],
      ['bookmarks', 'transcribe'],
    ]);
  });

  it('adopts a paused list written by another context', () => {
    for (const watcher of store.watchers) watcher(['x', 'youtube']);

    expect(isLibraryPaused('x-bookmarks')).toBe(true);
    expect(isLibraryPaused('youtube-playlists')).toBe(true);
    expect(isLibraryPaused('bilibili')).toBe(false);
    // A cross-context pause must also park THIS context's live runs — the
    // pause fan-out lives in the mirror swap, not only in the click path.
    expect(pauseJob.mock.calls).toEqual(
      expect.arrayContaining([
        ['x-bookmarks', 'sync'],
        ['youtube-playlists', 'sync'],
      ]),
    );
  });

  it('drops unknown platforms from a stale persisted value', () => {
    for (const watcher of store.watchers) watcher(['myspace', 'x']);

    expect(isLibraryPaused('x-bookmarks')).toBe(true);
    expect(gatePlatformOf('myspace')).toBeNull();
  });

  it('leaves non-platform job namespaces ungated', () => {
    expect(gatePlatformOf('webdav')).toBeNull();
    expect(isLibraryPaused('webdav')).toBe(false);
  });
});
