import { afterEach, describe, it, expect, vi } from 'vitest';
import { fetchPlaylistItems, parseIso8601Duration, parseChannelInput } from './youtube-api';

describe('parseIso8601Duration', () => {
  it('parses full H/M/S durations', () => {
    expect(parseIso8601Duration('PT1H2M3S')).toBe(3723);
    expect(parseIso8601Duration('PT2H')).toBe(7200);
    expect(parseIso8601Duration('PT15M33S')).toBe(933);
    expect(parseIso8601Duration('PT45S')).toBe(45);
  });

  it('handles the day component (long streams)', () => {
    expect(parseIso8601Duration('P1DT2H')).toBe(93600);
    expect(parseIso8601Duration('P2D')).toBe(172800);
  });

  it('returns 0 for zero / placeholder durations', () => {
    expect(parseIso8601Duration('PT0S')).toBe(0);
    expect(parseIso8601Duration('P0D')).toBe(0); // live / premiere placeholder
  });

  it('returns 0 for missing or unparseable input', () => {
    expect(parseIso8601Duration(null)).toBe(0);
    expect(parseIso8601Duration(undefined)).toBe(0);
    expect(parseIso8601Duration('')).toBe(0);
    expect(parseIso8601Duration('garbage')).toBe(0);
    expect(parseIso8601Duration('1H2M')).toBe(0); // missing P prefix
  });
});

describe('parseChannelInput', () => {
  const UC_ID = 'UC_x5XG1OV2P6uZZ5FSM9Ttw'; // UC + 22 chars

  it('recognizes a bare UC… channel id', () => {
    expect(parseChannelInput(UC_ID)).toEqual({ kind: 'id', value: UC_ID });
  });

  it('treats handles as handles, with or without the @', () => {
    expect(parseChannelInput('@GoogleDevelopers')).toEqual({
      kind: 'handle',
      value: '@GoogleDevelopers',
    });
    expect(parseChannelInput('GoogleDevelopers')).toEqual({
      kind: 'handle',
      value: 'GoogleDevelopers',
    });
  });

  it('strips youtube.com URL prefixes', () => {
    expect(parseChannelInput('https://www.youtube.com/@GoogleDevelopers')).toEqual({
      kind: 'handle',
      value: '@GoogleDevelopers',
    });
    expect(parseChannelInput(`https://www.youtube.com/channel/${UC_ID}`)).toEqual({
      kind: 'id',
      value: UC_ID,
    });
    expect(parseChannelInput('youtube.com/@handle/videos?view=0')).toEqual({
      kind: 'handle',
      value: '@handle',
    });
  });

  it('returns null for empty input', () => {
    expect(parseChannelInput('')).toBeNull();
    expect(parseChannelInput('   ')).toBeNull();
    expect(parseChannelInput('https://www.youtube.com/')).toBeNull();
  });

  it('a UC prefix with the wrong length falls back to handle', () => {
    expect(parseChannelInput('UCshort')).toEqual({ kind: 'handle', value: 'UCshort' });
  });
});

describe('fetchPlaylistItems cooperative control', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks control before claiming each playlist page', async () => {
    vi.useFakeTimers();
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [{ contentDetails: { videoId: 'v1' }, snippet: {} }],
            nextPageToken: 'next',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const checkpoint = vi.fn(async () => {});

    const run = fetchPlaylistItems('key', 'playlist', {
      needsDetails: () => false,
      control: { checkpoint },
    });
    await vi.runAllTimersAsync();
    await run;

    expect(checkpoint).toHaveBeenCalledTimes(2);
  });
});
