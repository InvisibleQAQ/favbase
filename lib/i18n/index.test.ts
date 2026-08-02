import { describe, it, expect, beforeEach, vi } from 'vitest';

// happy-dom provides navigator.language; detectLocale reads it. Default to 'en'
// then flip via setLocale in tests so we control the resolved locale.
import { t, setLocale, formatCompactNumber, getResolvedLocale } from './index';

// Mock the locale storage watch/getValue so setLocale('...') doesn't get
// overridden by the async localeStorage.getValue().then(...) at module load.
vi.mock('@/lib/storage', async () => {
  return {
    localeStorage: {
      getValue: () => Promise.resolve('en' as const),
      setValue: () => Promise.resolve(),
      watch: () => () => {},
    },
  };
});

describe('t() interpolation', () => {
  beforeEach(() => {
    setLocale('en');
  });

  it('replaces {{name}} placeholders', () => {
    // status.error = 'Failed to load: {{error}}'
    expect(t('status.error', { error: 'boom' })).toBe('Failed to load: boom');
  });

  it('returns the raw string when no params', () => {
    expect(t('settings.save')).toBe('Save');
  });

  it('falls back to the key when missing', () => {
    // @ts-expect-error intentional missing key
    expect(t('does.not.exist')).toBe('does.not.exist');
  });
});

describe('t() plural resolution', () => {
  it('en: count=1 selects .one variant', () => {
    setLocale('en');
    // collections.videoCount base = '{{count}} videos', .one = '{{count}} video'
    expect(t('collections.videoCount', { count: 1 })).toBe('1 video');
  });

  it('en: count=5 selects base/.other variant', () => {
    setLocale('en');
    expect(t('collections.videoCount', { count: 5 })).toBe('5 videos');
  });

  it('zh-CN: always resolves to base (.other) form', () => {
    setLocale('zh-CN');
    expect(t('collections.videoCount', { count: 1 })).toBe('1 个视频');
    expect(t('collections.videoCount', { count: 5 })).toBe('5 个视频');
  });

  it('falls back to base key when no plural variants exist', () => {
    setLocale('en');
    // settings.fetchModelsSuccess has no .one/.other variants, just base with {{count}}
    expect(t('settings.fetchModelsSuccess', { count: 3 })).toBe('Found 3 available models');
  });

  it('selects dashboard plurality from a numeric count while displaying a formatted value', () => {
    setLocale('en');
    expect(t('dashboard.itemCount', { count: 1, value: '1' })).toBe('1 item');
    expect(t('dashboard.itemCount', { count: 1000, value: '1,000' })).toBe('1,000 items');
  });
});

describe('platform labels', () => {
  it('labels the analytics navigation consistently in both locales', () => {
    setLocale('en');
    expect(t('nav.dashboard')).toBe('Analytics');

    setLocale('zh-CN');
    expect(t('nav.dashboard')).toBe('Analytics');
  });

  it('identifies browser bookmarks consistently in navigation and page title', () => {
    setLocale('en');
    expect(t('nav.bookmarks')).toBe('Browser Bookmarks');
    expect(t('bookmarks.title')).toBe('Browser Bookmarks');

    setLocale('zh-CN');
    expect(t('nav.bookmarks')).toBe('浏览器书签');
    expect(t('bookmarks.title')).toBe('浏览器书签');
  });
});

describe('formatCompactNumber', () => {
  it('en: compact K/M', () => {
    setLocale('en');
    expect(getResolvedLocale()).toBe('en');
    expect(formatCompactNumber(12000)).toBe('12K');
    expect(formatCompactNumber(1200000)).toBe('1.2M');
  });

  it('zh-CN: compact 万/亿', () => {
    setLocale('zh-CN');
    expect(getResolvedLocale()).toBe('zh-CN');
    expect(formatCompactNumber(12000)).toBe('1.2万');
    expect(formatCompactNumber(120000000)).toBe('1.2亿');
  });
});
