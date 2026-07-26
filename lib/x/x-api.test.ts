import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseTweets,
  extractBottomCursor,
  mapTweetToRow,
  buildBookmarksUrl,
  fetchAllBookmarks,
  fetchPageWithBackoff,
  XRateLimitError,
  XAuthError,
} from './x-api';

// ---------------------------------------------------------------------------
// Fixtures — minimal slices of the Bookmarks timeline response shape.
// ---------------------------------------------------------------------------

function tweetResult(id: string, handle = 'alice', name = 'Alice') {
  return {
    rest_id: id,
    core: {
      user_results: {
        result: {
          rest_id: `u_${handle}`,
          legacy: {
            screen_name: handle,
            name,
            profile_image_url_https: `https://pbs.twimg.com/${handle}.jpg`,
          },
        },
      },
    },
    legacy: {
      full_text: `text of ${id}`,
      created_at: 'Wed Jan 01 00:00:00 +0000 2025',
      favorite_count: 7,
      retweet_count: 3,
      reply_count: 2,
      lang: 'en',
    },
  };
}

function itemEntry(id: string, handle?: string, name?: string) {
  return {
    entryId: `tweet-${id}`,
    content: {
      entryType: 'TimelineTimelineItem',
      itemContent: { tweet_results: { result: tweetResult(id, handle, name) } },
    },
  };
}

function cursorEntry(type: string, value: string) {
  return {
    entryId: `cursor-${type.toLowerCase()}-x`,
    content: { entryType: 'TimelineTimelineCursor', cursorType: type, value },
  };
}

describe('mapTweetToRow', () => {
  it('maps a tweet result to a normalized row + derives the url', () => {
    const row = mapTweetToRow(tweetResult('123'));
    expect(row).toEqual({
      id: '123',
      text: 'text of 123',
      createdAt: 'Wed Jan 01 00:00:00 +0000 2025',
      author: {
        handle: 'alice',
        name: 'Alice',
        avatarUrl: 'https://pbs.twimg.com/alice.jpg',
        restId: 'u_alice',
      },
      media: [],
      likeCount: 7,
      retweetCount: 3,
      replyCount: 2,
      lang: 'en',
      url: 'https://x.com/alice/status/123',
    });
  });

  it('unwraps TweetWithVisibilityResults (result.tweet)', () => {
    const wrapped = { tweet: tweetResult('999', 'bob', 'Bob') };
    const row = mapTweetToRow(wrapped);
    expect(row?.id).toBe('999');
    expect(row?.author.handle).toBe('bob');
  });

  it('extracts photo + best video variant from media', () => {
    const base = tweetResult('m1');
    (base.legacy as Record<string, unknown>).extended_entities = {
      media: [
        { type: 'photo', media_url_https: 'https://pbs.twimg.com/pic.jpg' },
        {
          type: 'video',
          media_url_https: 'https://pbs.twimg.com/thumb.jpg',
          video_info: {
            variants: [
              { content_type: 'video/mp4', bitrate: 256000, url: 'https://video/low.mp4' },
              { content_type: 'video/mp4', bitrate: 832000, url: 'https://video/high.mp4' },
              { content_type: 'application/x-mpegURL', url: 'https://video/playlist.m3u8' },
            ],
          },
        },
      ],
    };
    const row = mapTweetToRow(base);
    expect(row?.media).toEqual([
      { type: 'photo', url: 'https://pbs.twimg.com/pic.jpg' },
      { type: 'video', url: 'https://video/high.mp4' },
    ]);
  });

  it('returns null for unusable results (no rest_id / user / legacy)', () => {
    expect(mapTweetToRow(null)).toBeNull();
    expect(mapTweetToRow({})).toBeNull();
    expect(mapTweetToRow({ rest_id: 'x' })).toBeNull();
  });
});

describe('parseTweets', () => {
  it('collects all tweet entries, skipping cursors', () => {
    const instructions = [
      {
        type: 'TimelineAddEntries',
        entries: [
          itemEntry('1'),
          cursorEntry('Top', 'top-cur'),
          itemEntry('2'),
          cursorEntry('Bottom', 'bottom-cur'),
        ],
      },
    ];
    const rows = parseTweets(instructions);
    expect(rows.map((r) => r.id)).toEqual(['1', '2']);
  });

  it('tolerates empty / missing instructions', () => {
    expect(parseTweets([])).toEqual([]);
    expect(parseTweets([{ type: 'X' }])).toEqual([]);
  });
});

describe('extractBottomCursor', () => {
  it('returns the Bottom cursor value', () => {
    const instructions = [
      {
        entries: [cursorEntry('Top', 'top-cur'), itemEntry('1'), cursorEntry('Bottom', 'next-page')],
      },
    ];
    expect(extractBottomCursor(instructions)).toBe('next-page');
  });

  it('returns null when there is no Bottom cursor', () => {
    expect(extractBottomCursor([{ entries: [itemEntry('1')] }])).toBeNull();
    expect(extractBottomCursor([])).toBeNull();
  });
});

describe('buildBookmarksUrl', () => {
  it('builds first-page url (no cursor) with the hardcoded queryId + static features, NO fieldToggles', () => {
    const url = buildBookmarksUrl();
    expect(
      url.startsWith('https://x.com/i/api/graphql/xLjCVTqYWz8CGSprLU349w/Bookmarks?'),
    ).toBe(true);

    const params = new URL(url).searchParams;
    const variables = JSON.parse(params.get('variables')!);
    // Mirrors the real bookmarks page: count 100, promoted content off, no
    // cursor on page 1. NO querySource/rawQuery (search-op only).
    expect(variables).toEqual({ count: 100, includePromotedContent: false });
    expect(variables.cursor).toBeUndefined();

    // Static features map — a couple of known keys must be present (a missing
    // key is an HTTP 400 "features cannot be null").
    const features = JSON.parse(params.get('features')!);
    expect(features.graphql_timeline_v2_bookmark_timeline).toBe(true);
    expect(features.view_counts_everywhere_api_enabled).toBe(true);

    // supermemory omits fieldToggles entirely — the param must be absent.
    expect(params.get('fieldToggles')).toBeNull();
  });

  it('includes cursor + custom count when provided', () => {
    const url = buildBookmarksUrl({ count: 50, cursor: 'CUR' });
    const variables = JSON.parse(new URL(url).searchParams.get('variables')!);
    expect(variables.count).toBe(50);
    expect(variables.cursor).toBe('CUR');
  });
});

// ---------------------------------------------------------------------------
// fetchPageWithBackoff — never swallow a server-side rejection into a silent []
// (regression for the "抓取数为0 with no error" bug). Drives a mocked global
// fetch; no network is touched.
// ---------------------------------------------------------------------------

describe('fetchPageWithBackoff — error surfacing', () => {
  const URL_ = 'https://x.com/i/api/graphql/xLjCVTqYWz8CGSprLU349w/Bookmarks?x=1';
  const HEADERS = { authorization: 'Bearer test' };

  function mockFetchOnce(body: unknown, init: ResponseInit = { status: 200 }) {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), init));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws (does NOT return []) on a 200 carrying GraphQL errors[] with code ≠ 88', async () => {
    mockFetchOnce({ errors: [{ code: 73, message: 'BadRequest' }] });
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toThrow(/GraphQL errors/);
    // The thrown message must carry the code, the message, and the queryId diagnostic.
    mockFetchOnce({ errors: [{ code: 73, message: 'BadRequest' }] });
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toThrow(/code 73/);
    mockFetchOnce({ errors: [{ code: 73, message: 'BadRequest' }] });
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toThrow(
      /queryId=xLjCVTqYWz8CGSprLU349w/,
    );
  });

  it('still yields XRateLimitError on a 200 with code:88 (unchanged)', async () => {
    // The retry loop sleeps to reset between attempts; fake timers keep it fast
    // and deterministic instead of burning 5 real seconds of MIN_SLEEP floors.
    vi.useFakeTimers();
    try {
      const reset = String(Math.floor(Date.now() / 1000) - 10); // past → MIN_SLEEP floor
      // Fresh Response per call — the retry loop consumes each body once.
      global.fetch = vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ errors: [{ code: 88, message: 'RateLimited' }] }), {
            status: 200,
            headers: { 'x-rate-limit-reset': reset },
          }),
      );
      const p = fetchPageWithBackoff(URL_, HEADERS);
      // Drive the awaited sleeps to completion, then assert the rejection.
      const assertion = expect(p).rejects.toBeInstanceOf(XRateLimitError);
      await vi.runAllTimersAsync();
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses the happy path: 200 + bookmark_timeline_v2 with one tweet', async () => {
    mockFetchOnce({
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [itemEntry('42', 'carol', 'Carol')],
              },
            ],
          },
        },
      },
    });
    const { json } = await fetchPageWithBackoff(URL_, HEADERS);
    const rows = parseTweets(
      (json as { data: { bookmark_timeline_v2: { timeline: { instructions: RawInst[] } } } }).data
        .bookmark_timeline_v2.timeline.instructions,
    );
    expect(rows.map((r) => r.id)).toEqual(['42']);
  });

  it('returns the response WITHOUT throwing on an empty (zero-bookmarks) timeline', async () => {
    mockFetchOnce({
      data: { bookmark_timeline_v2: { timeline: { instructions: [] } } },
    });
    const { json } = await fetchPageWithBackoff(URL_, HEADERS);
    expect(json).toBeTruthy();
    // No throw = the empty case is a legit result, not swallowed error.
  });

  it('throws on a 200 with NEITHER errors NOR a timeline (unexpected shape)', async () => {
    mockFetchOnce({ data: { something_else: {} } });
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toThrow(
      /unexpected X response shape/,
    );
    mockFetchOnce({ data: { something_else: {} } });
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toThrow(
      /queryId=xLjCVTqYWz8CGSprLU349w/,
    );
  });

  it('maps 401 → XAuthError and 403 → XAuthError (no regression)', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toBeInstanceOf(XAuthError);

    global.fetch = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    await expect(fetchPageWithBackoff(URL_, HEADERS)).rejects.toBeInstanceOf(XAuthError);
  });

  it('checks control before each retry attempt', async () => {
    vi.useFakeTimers();
    try {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce(new Response('temporary', { status: 500 }))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              data: { bookmark_timeline_v2: { timeline: { instructions: [] } } },
            }),
            { status: 200 },
          ),
        );
      const checkpoint = vi.fn(async () => {});

      const run = fetchPageWithBackoff(URL_, HEADERS, { checkpoint });
      await vi.runAllTimersAsync();
      await run;

      expect(checkpoint).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fetchAllBookmarks cooperative control', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('checks control before claiming each page', async () => {
    vi.useFakeTimers();
    const firstPage = {
      data: {
        bookmark_timeline_v2: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: [itemEntry('1'), cursorEntry('Bottom', 'next')],
              },
            ],
          },
        },
      },
    };
    const lastPage = {
      data: { bookmark_timeline_v2: { timeline: { instructions: [] } } },
    };
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(firstPage), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(lastPage), { status: 200 }));
    const checkpoint = vi.fn(async () => {});

    const run = fetchAllBookmarks(
      { cookie: 'cookie', csrf: 'csrf', auth: 'Bearer test' },
      undefined,
      { control: { checkpoint } },
    );
    await vi.runAllTimersAsync();
    await run;

    expect(checkpoint).toHaveBeenCalledTimes(2);
  });
});

type RawInst = Parameters<typeof parseTweets>[0][number];
