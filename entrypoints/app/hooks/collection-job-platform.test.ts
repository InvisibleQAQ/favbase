import { describe, expect, it } from 'vitest';

import type { CollectionPlatform } from '@/lib/collections/platforms';

import {
  collectionPlatformForJob,
  jobPlatformForCollection,
} from './collection-job-platform';

const JOB_NAMESPACES: Record<CollectionPlatform, string> = {
  bilibili: 'bilibili',
  github: 'github-stars',
  bookmarks: 'bookmarks',
  x: 'x-bookmarks',
  zhihu: 'zhihu-favorites',
  youtube: 'youtube-playlists',
};

describe('Collection job platform mapping', () => {
  it('round-trips every Collection platform through its job namespace', () => {
    for (const [platform, jobPlatform] of Object.entries(JOB_NAMESPACES)) {
      expect(jobPlatformForCollection(platform as CollectionPlatform)).toBe(jobPlatform);
      expect(collectionPlatformForJob(jobPlatform)).toBe(platform);
    }
  });

  it('accepts canonical discriminators and rejects unrelated job namespaces', () => {
    expect(collectionPlatformForJob('github')).toBe('github');
    expect(collectionPlatformForJob('webdav')).toBeNull();
  });
});
