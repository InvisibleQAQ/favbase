import { describe, expect, it } from 'vitest';

import { BiliAuthError, BiliRateLimitError } from '@/lib/bilibili/bilibili-api';
import { GithubAuthError, GithubRateLimitError } from '@/lib/github/github-api';
import { XAuthError, XRateLimitError } from '@/lib/x/x-api';
import { YoutubeAuthError, YoutubeRateLimitError } from '@/lib/youtube/youtube-api';
import { ZhihuAuthError, ZhihuRateLimitError } from '@/lib/zhihu/zhihu-api';

import { PlatformAuthError, PlatformRateLimitError } from './sync-errors';

/**
 * The shared bases hold the fields; every platform's real error class — not a
 * mock — must be an instance of its base and keep its own `name` (a production
 * build mangles class names, so the explicit `name` is what logs show).
 */
describe('platform error bases', () => {
  const RESET = new Date('2026-09-30T12:00:00Z');

  it.each([
    ['BiliAuthError', new BiliAuthError('m', 'missing'), 'missing'],
    ['BiliAuthError', new BiliAuthError('m', 'rejected'), 'rejected'],
    ['GithubAuthError', new GithubAuthError('m', 'rejected'), 'rejected'],
    ['ZhihuAuthError', new ZhihuAuthError('m', 'missing'), 'missing'],
    ['YoutubeAuthError', new YoutubeAuthError('m', 'rejected'), 'rejected'],
    ['XAuthError', new XAuthError('m', 'missing'), 'missing'],
    ['XAuthError', new XAuthError('m', 'rejected'), 'rejected'],
  ] as const)('%s (%s) is a PlatformAuthError', (name, error, reason) => {
    expect(error).toBeInstanceOf(PlatformAuthError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PlatformRateLimitError);
    expect(error.name).toBe(name);
    expect(error.message).toBe('m');
    expect(error.reason).toBe(reason);
  });

  it.each([
    ['BiliRateLimitError', new BiliRateLimitError('m'), null],
    ['GithubRateLimitError', new GithubRateLimitError('m', RESET), RESET],
    ['GithubRateLimitError', new GithubRateLimitError('m', null), null],
    ['ZhihuRateLimitError', new ZhihuRateLimitError('m'), null],
    ['YoutubeRateLimitError', new YoutubeRateLimitError('m'), null],
    ['YoutubeRateLimitError', new YoutubeRateLimitError('m', RESET), RESET],
    ['XRateLimitError', new XRateLimitError('m', RESET), RESET],
    ['XRateLimitError', new XRateLimitError('m', null), null],
  ] as const)('%s is a PlatformRateLimitError', (name, error, resetAt) => {
    expect(error).toBeInstanceOf(PlatformRateLimitError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PlatformAuthError);
    expect(error.name).toBe(name);
    expect(error.message).toBe('m');
    expect(error.resetAt).toBe(resetAt);
  });
});
