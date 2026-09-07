import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import type { LocaleKeys } from '@/lib/i18n';
import type { BackgroundJob } from '../../hooks/background-jobs-store';
import { backgroundJobDetail, backgroundJobPlatformLabel } from './background-jobs-indicator';

const messages: Partial<Record<LocaleKeys, string>> = {
  'backgroundJobs.embedding': 'Embedding {{done}}/{{total}}',
  'backgroundJobs.kind.embed': 'Embedding',
  'backgroundJobs.phase.paused': 'Paused: {{detail}}',
};

function translate(
  key: LocaleKeys,
  params: Record<string, string | number> = {},
): string {
  return (messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(params[name] ?? ''),
  );
}

describe('background job platform label', () => {
  // docs/26 Step 2 replaced the hand-written `PLATFORM_LABEL` table with a join
  // across the two Platform Descriptors. These six pairs are what the table
  // held, so they are the lock that the reminder copy did not change.
  it.each([
    ['bilibili', 'nav.bilibiliFavorites'],
    ['github-stars', 'nav.githubStars'],
    ['bookmarks', 'nav.bookmarks'],
    ['x-bookmarks', 'nav.xBookmarks'],
    ['zhihu-favorites', 'nav.zhihuFavorites'],
    ['youtube-playlists', 'nav.youtubePlaylists'],
  ])('names %s after its platform', (jobPlatform, key) => {
    expect(backgroundJobPlatformLabel(jobPlatform, translate)).toBe(key);
  });

  it('falls back to the raw namespace for a job that is not a platform', () => {
    expect(backgroundJobPlatformLabel('p-runtime-adapter', translate)).toBe('p-runtime-adapter');
  });
});

describe('background job reminder detail', () => {
  it('identifies a paused lane without describing it as running', () => {
    const job: BackgroundJob = {
      platform: 'x-bookmarks',
      kind: 'embed',
      phase: 'paused',
      running: true,
      progress: { done: 2, total: 5 },
      lastProgress: null,
      error: null,
      generation: 0,
    };

    expect(backgroundJobDetail(job, translate)).toBe('Paused: Embedding 2/5');
  });
});
