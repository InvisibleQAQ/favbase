import { describe, expect, it, vi } from 'vitest';

import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';

// The real processing workers resolve provider settings at module load. Resume
// tests inject the scheduler boundary, so extension storage is outside scope.
vi.mock('@/lib/storage', () => ({
  settingsStorage: { getValue: vi.fn() },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
}));

import { resumeCollectionProcessing } from './collection-processing-resume';

describe('resumeCollectionProcessing', () => {
  it('translates every Collection platform through the canonical job namespace map', () => {
    const startBacklog = vi.fn();

    for (const platform of COLLECTION_PLATFORMS) {
      resumeCollectionProcessing(platform, 'embedding', { startBacklog });
    }

    expect(startBacklog.mock.calls.map((call) => call[0])).toEqual([
      { jobPlatform: 'bilibili', itemPlatform: 'bilibili', capability: 'embedding' },
      { jobPlatform: 'github-stars', itemPlatform: 'github', capability: 'embedding' },
      { jobPlatform: 'bookmarks', itemPlatform: 'bookmarks', capability: 'embedding' },
      { jobPlatform: 'x-bookmarks', itemPlatform: 'x', capability: 'embedding' },
      { jobPlatform: 'zhihu-favorites', itemPlatform: 'zhihu', capability: 'embedding' },
      { jobPlatform: 'youtube-playlists', itemPlatform: 'youtube', capability: 'embedding' },
    ]);
  });

  it('dispatches LLM saves to the Tags backlog capability', () => {
    const startBacklog = vi.fn();

    resumeCollectionProcessing('github', 'llm', { startBacklog });

    expect(startBacklog).toHaveBeenCalledWith({
      jobPlatform: 'github-stars',
      itemPlatform: 'github',
      capability: 'llm',
    });
  });
});
