import { describe, it, expect } from 'vitest';

import { narrowGithubMeta } from './github-sync-service';

const DEFAULTS = {
  description: null,
  language: null,
  stargazersCount: 0,
  forksCount: 0,
  topics: [] as string[],
  pushedAt: null,
  starredAt: null,
  ownerAvatarUrl: null,
};

describe('narrowGithubMeta', () => {
  it('returns all safe defaults for empty / non-object meta', () => {
    expect(narrowGithubMeta(undefined)).toEqual(DEFAULTS);
    expect(narrowGithubMeta(null)).toEqual(DEFAULTS);
    expect(narrowGithubMeta('nope')).toEqual(DEFAULTS);
    expect(narrowGithubMeta(42)).toEqual(DEFAULTS);
  });

  it('passes through a well-formed meta', () => {
    const meta = {
      description: 'a repo',
      language: 'TypeScript',
      stargazersCount: 12,
      forksCount: 3,
      topics: ['cli', 'ai'],
      pushedAt: '2026-01-01T00:00:00Z',
      starredAt: '2026-02-02T00:00:00Z',
      ownerAvatarUrl: 'https://x/y.png',
    };
    expect(narrowGithubMeta(meta)).toEqual(meta);
  });

  it('drops malformed field types to defaults (safer than the old ?? null)', () => {
    expect(
      narrowGithubMeta({
        description: 123,
        language: {},
        stargazersCount: '5',
        forksCount: null,
        topics: 'not-array',
        pushedAt: 0,
        starredAt: false,
        ownerAvatarUrl: [],
      }),
    ).toEqual(DEFAULTS);
  });
});
