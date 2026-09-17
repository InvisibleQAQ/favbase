import { describe, it, expect, beforeEach, vi } from 'vitest';

// happy-dom provides navigator.language; detectLocale reads it. Default to 'en'
// then flip via setLocale in tests so we control the resolved locale.
import { t, setLocale, formatCompactNumber, getResolvedLocale } from './index';
import type { LocaleKeys } from './locales/zh-CN';
import { transcribeErrorSchema } from '@/lib/runtime-message/schemas';
import type { TranscribeErrorCode } from '@/lib/transcription/types';

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

// A TS union cannot be enumerated at runtime, so the honest set of error codes
// has to come from the wire enum. These two aliases make that enum a faithful
// copy of `TranscribeErrorCode`: either side gaining a member the other lacks
// fails to compile, so the list below can never quietly go short.
type WireErrorCode = (typeof transcribeErrorSchema.shape.code.options)[number];
type DomainCoversWire = WireErrorCode extends TranscribeErrorCode ? true : never;
type WireCoversDomain = TranscribeErrorCode extends WireErrorCode ? true : never;
const errorCodeParity: [DomainCoversWire, WireCoversDomain] = [true, true];

describe('transcribe error codes', () => {
  // The parity check itself is the type annotation above — tsc is what reds.
  // This case exists so the assertion has a live consumer and survives a future
  // "unused variable" cleanup.
  it('holds the wire/domain parity assertion that tsc enforces', () => {
    expect(errorCodeParity).toEqual([true, true]);
  });

  // Both consumers render `error.${code}` (app.html `video-card.tsx` and the
  // content script's `TranscribeButton.tsx`). A code with no locale entry shows
  // the user the raw key: t() falls back to it and nothing else reds.
  it.each(transcribeErrorSchema.shape.code.options)('translates %s in both locales', (code) => {
    const key = `error.${code}` as LocaleKeys;

    setLocale('en');
    expect(t(key)).not.toBe(key);

    setLocale('zh-CN');
    expect(t(key)).not.toBe(key);
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
