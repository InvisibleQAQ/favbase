import { describe, it, expect } from 'vitest';
import {
  parseTweets,
  extractBottomCursor,
  mapTweetToRow,
  buildBookmarksUrl,
  parseQueryIdFromBundle,
} from './x-api';

// ---------------------------------------------------------------------------
// Fixtures — minimal slices of the BookmarkSearchTimeline response shape.
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
  it('builds first-page url (no cursor) with only true features + PAGE_SIZE', () => {
    const url = buildBookmarksUrl('QID');
    expect(url.startsWith('https://x.com/i/api/graphql/QID/BookmarkSearchTimeline?')).toBe(true);

    const params = new URL(url).searchParams;
    const variables = JSON.parse(params.get('variables')!);
    expect(variables).toEqual({ count: 20, querySource: '', rawQuery: '' });
    expect(variables.cursor).toBeUndefined();

    const features = JSON.parse(params.get('features')!);
    // 414-trap: every emitted feature must be true (false ones omitted).
    expect(Object.values(features).every((v) => v === true)).toBe(true);
    expect(features.graphql_timeline_v2_bookmark_timeline).toBe(true);
    expect(features.responsive_web_enhance_cards_enabled).toBeUndefined();
  });

  it('includes cursor + custom count when provided', () => {
    const url = buildBookmarksUrl('QID', { count: 50, cursor: 'CUR' });
    const variables = JSON.parse(new URL(url).searchParams.get('variables')!);
    expect(variables.count).toBe(50);
    expect(variables.cursor).toBe('CUR');
  });
});

describe('parseQueryIdFromBundle', () => {
  it('parses operationName → queryId (both orderings)', () => {
    const b1 = 'foo{queryId:"abc123-QID",operationName:"BookmarkSearchTimeline"}bar';
    expect(parseQueryIdFromBundle(b1, 'BookmarkSearchTimeline')).toBe('abc123-QID');

    const b2 = 'foo{operationName:"BookmarkSearchTimeline",queryId:"zzz-999"}bar';
    expect(parseQueryIdFromBundle(b2, 'BookmarkSearchTimeline')).toBe('zzz-999');
  });

  it('returns null when the operation is absent', () => {
    expect(parseQueryIdFromBundle('nothing here', 'BookmarkSearchTimeline')).toBeNull();
  });
});
