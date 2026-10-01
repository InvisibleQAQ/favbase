import { describe, expect, it, vi } from 'vitest';

import { BiliAuthError, BiliRateLimitError } from '@/lib/bilibili/bilibili-api';
import { GithubAuthError, GithubRateLimitError } from '@/lib/github/github-api';
import { XAuthError, XRateLimitError } from '@/lib/x/x-api';
import { YoutubeAuthError, YoutubeRateLimitError } from '@/lib/youtube/youtube-api';
import { ZhihuAuthError, ZhihuRateLimitError } from '@/lib/zhihu/zhihu-api';

// The copy half reads `@/lib/i18n`, which touches chrome.storage at load. A
// transparent stand-in keeps the assertions about which key is chosen.
vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  formatDateTime: (ms: number) => `@${ms}`,
}));

import {
  classifyCollectionSyncError,
  rateLimitRemainingMs,
  type CollectionSyncError,
} from './collection-sync-error';
import { syncErrorMessage, type SyncErrorCopy } from './collection-sync-error-message';

const RESET = new Date('2026-09-30T12:00:00Z');

describe('classifyCollectionSyncError', () => {
  it.each([
    ['bilibili missing', new BiliAuthError('no cookie', 'missing'), 'missing'],
    ['bilibili rejected', new BiliAuthError('-101', 'rejected'), 'rejected'],
    ['github', new GithubAuthError('401', 'rejected'), 'rejected'],
    ['zhihu', new ZhihuAuthError('401', 'missing'), 'missing'],
    ['youtube', new YoutubeAuthError('keyInvalid', 'rejected'), 'rejected'],
    ['x missing', new XAuthError('no session', 'missing'), 'missing'],
    ['x rejected', new XAuthError('403', 'rejected'), 'rejected'],
  ] as const)('%s auth error → auth with its reason', (_label, error, reason) => {
    expect(classifyCollectionSyncError(error)).toEqual({
      kind: 'auth',
      reason,
      message: error.message,
    });
  });

  it.each([
    ['bilibili 412', new BiliRateLimitError('Bilibili API HTTP 412'), null],
    ['github with reset', new GithubRateLimitError('403', RESET), RESET],
    ['github without reset', new GithubRateLimitError('403', null), null],
    ['zhihu', new ZhihuRateLimitError('429'), null],
    ['youtube', new YoutubeRateLimitError('quota'), null],
    ['x with reset', new XRateLimitError('429', RESET), RESET],
    ['x without reset', new XRateLimitError('code:88', null), null],
  ] as const)('%s → rate-limit carrying resetAt', (_label, error, resetAt) => {
    expect(classifyCollectionSyncError(error)).toEqual({
      kind: 'rate-limit',
      resetAt,
      message: error.message,
    });
  });

  it('a plain Error is unknown and keeps its message', () => {
    expect(classifyCollectionSyncError(new Error('GitHub API HTTP 500'))).toEqual({
      kind: 'unknown',
      message: 'GitHub API HTTP 500',
    });
  });

  it('a non-Error is unknown with String(err)', () => {
    expect(classifyCollectionSyncError('boom')).toEqual({ kind: 'unknown', message: 'boom' });
    expect(classifyCollectionSyncError(42)).toEqual({ kind: 'unknown', message: '42' });
  });
});

describe('syncErrorMessage', () => {
  const FULL: SyncErrorCopy = {
    auth: 'x.notLoggedInTitle',
    authRejected: 'x.sessionRejectedTitle',
    rateLimited: 'x.rateLimitedNoReset',
    rateLimitedUntil: 'x.rateLimited',
  };
  const BASIC: SyncErrorCopy = {
    auth: 'zhihu.notLoggedInTitle',
    rateLimited: 'zhihu.rateLimited',
  };
  const auth = (reason: 'missing' | 'rejected'): CollectionSyncError => ({
    kind: 'auth',
    reason,
    message: 'raw',
  });
  const rateLimit = (resetAt: Date | null): CollectionSyncError => ({
    kind: 'rate-limit',
    resetAt,
    message: 'raw',
  });

  it('auth: `rejected` uses authRejected when the platform has it', () => {
    expect(syncErrorMessage(auth('rejected'), FULL)).toBe('x.sessionRejectedTitle');
    expect(syncErrorMessage(auth('missing'), FULL)).toBe('x.notLoggedInTitle');
  });

  it('auth: without authRejected both reasons fall back to the auth key', () => {
    expect(syncErrorMessage(auth('rejected'), BASIC)).toBe('zhihu.notLoggedInTitle');
    expect(syncErrorMessage(auth('missing'), BASIC)).toBe('zhihu.notLoggedInTitle');
  });

  it('rate-limit: a known reset uses rateLimitedUntil with the formatted time', () => {
    expect(syncErrorMessage(rateLimit(RESET), FULL)).toBe(
      `x.rateLimited ${JSON.stringify({ reset: `@${RESET.getTime()}` })}`,
    );
  });

  it('rate-limit: no reset, or no until key, uses rateLimited', () => {
    expect(syncErrorMessage(rateLimit(null), FULL)).toBe('x.rateLimitedNoReset');
    expect(syncErrorMessage(rateLimit(RESET), BASIC)).toBe('zhihu.rateLimited');
    expect(syncErrorMessage(rateLimit(null), BASIC)).toBe('zhihu.rateLimited');
  });

  it('unknown: the raw message, untranslated', () => {
    expect(syncErrorMessage({ kind: 'unknown', message: 'Bookmarks API failed' }, FULL)).toBe(
      'Bookmarks API failed',
    );
  });
});

describe('rateLimitRemainingMs', () => {
  const NOW = RESET.getTime() - 90_000;

  it('is 0 without an error, or for a non-rate-limit error', () => {
    expect(rateLimitRemainingMs(null, NOW)).toBe(0);
    expect(rateLimitRemainingMs({ kind: 'auth', reason: 'rejected', message: '' }, NOW)).toBe(0);
    expect(rateLimitRemainingMs({ kind: 'unknown', message: '' }, NOW)).toBe(0);
  });

  it('is 0 when the rate limit names no reset', () => {
    expect(rateLimitRemainingMs({ kind: 'rate-limit', resetAt: null, message: '' }, NOW)).toBe(0);
  });

  it('is 0 once the reset has passed, and exactly at it', () => {
    const error: CollectionSyncError = { kind: 'rate-limit', resetAt: RESET, message: '' };
    expect(rateLimitRemainingMs(error, RESET.getTime())).toBe(0);
    expect(rateLimitRemainingMs(error, RESET.getTime() + 1)).toBe(0);
  });

  it('is the time left before a future reset', () => {
    const error: CollectionSyncError = { kind: 'rate-limit', resetAt: RESET, message: '' };
    expect(rateLimitRemainingMs(error, NOW)).toBe(90_000);
  });
});
