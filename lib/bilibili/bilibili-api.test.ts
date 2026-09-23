import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchCidByPageList, fetchFavFolders, fetchFavVideos, fetchSubtitle } from './bilibili-api';
import type { BiliFavFolder, SubtitleTrack } from './types';

/**
 * `fetchSubtitle` must never hand back another video's subtitle (docs/29 C1/C4):
 * the non-wbi `x/player/v2` serves logged-in requests tracks that belong to
 * other videos, and B站 names a video's original AI subtitle file `{aid}{cid}{md5}`
 * (its machine translations carry a bare md5 and name no owner, see below).
 *
 * Fixtures are real, not invented. Collected with their sources in
 * `.trellis/tasks/09-17-bilibili-transcripts-land-on-the-wrong-items/research/ai-subtitle-url-ownership-evidence.md`:
 * - REQUEST / OWN_URL / FOREIGN_URL — yt-dlp PR #11708: one request (bvid
 *   derived from its aid), the track `x/player/wbi/v2` returned for it, and the
 *   foreign track (#1) `x/player/v2` returned for the very same request.
 * - DIGIT_LED — Cooper-X-Oak/LongYinMod_RisingFame: an owned track whose md5
 *   tail starts with a digit, so the owner cannot be found by splitting digits.
 * - UPLOADER_CC_URL is synthetic: uploader CC file names carry no owner at all.
 * - PREFIX_OF_OWNER is a synthetic request whose `{aid}{cid}` is a strict prefix
 *   of OWN_URL's owner: the md5 tail, not a bare startsWith, is what rejects it.
 *
 * Machine-translated tracks (docs/29 Step 1b) are a composite of two real sources:
 * - E1_TRANSLATIONS — docs/29 E1, run by the user on their own account
 *   (2026-09-23): `x/player/wbi/v2`'s ai-en/ja/es/ar/pt tracks of one Chinese
 *   video. Their file names are a bare md5 with no `{aid}{cid}`, unchanged over
 *   16 requests. E1 logged `lan` and file name only: the `auth_key` is synthetic
 *   (real format) and every translation `lan_doc` is synthetic.
 * - They sit beside REQUEST's real tracks above. EN_ORIGINAL / FOREIGN_ORIGINAL
 *   relabel OWN_URL / FOREIGN_URL as an English original; ZH_TRANSLATION borrows
 *   E1's ai-es name, since E1's Chinese video had no zh translation to observe.
 *   Neither an English original's nor a zh translation's `lan_doc` was ever
 *   observed; the code only asks whether `lan_doc` includes '中文'.
 *
 * `fetch` is stubbed at the global boundary, so the real `fetchWithDeadline` runs.
 */

const REQUEST = { bvid: 'BV1hcmhY8EbB', aid: 113470703931990, cid: 26731938624 };
const OWN_URL =
  '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/11347070393199026731938624d2e6f10bd77a075e49b793b12ab8bf73?auth_key=1733141975-be61791b7526450db96b8141994e9300-0-17391f3ea1538b8e3a721d3e9b297c8a';
const FOREIGN_URL =
  '//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/113384720701738265043985411da261a20ff661ad1742661f045442eb?auth_key=1733141553-2cb7a684118a43b0805fb8218fa0d3d5-0-3a8c2b0ae88228cf5e2abd7305e0a3dd';
const DIGIT_LED = {
  bvid: 'BV1wVwrzkEnh',
  aid: 116253490416509,
  cid: 36803445678,
  url: 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1162534904165093680344567858270d9138f2d9de897d9cd5f9724677?auth_key=1774421015-b0054872c03d4f4a83e41a220298a336-0-4a15683a0d8ce6f19a9f97db843b72ca',
};
const UPLOADER_CC_URL = '//i0.hdslb.com/bfs/subtitle/5f3c9e1a2b7d4c6e8f0a1b2c3d4e5f6a.json';
const PREFIX_OF_OWNER = { aid: 1134707039319, cid: 9026731938 };

/** FOREIGN_URL's file name: whose track it is, without the signed query. */
const FOREIGN_NAME = '113384720701738265043985411da261a20ff661ad1742661f045442eb';

const SYNTHETIC_AUTH_KEY = `1790000000-${'a'.repeat(32)}-0-${'b'.repeat(32)}`;

function translationUrl(md5: string): string {
  return `//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/${md5}?auth_key=${SYNTHETIC_AUTH_KEY}`;
}

const E1_TRANSLATIONS: SubtitleTrack[] = [
  { lan: 'ai-en', lan_doc: '英语（自动翻译）', subtitle_url: translationUrl('0b4ca2ed012f2b3fbb9261cd124e0db9') },
  { lan: 'ai-ja', lan_doc: '日语（自动翻译）', subtitle_url: translationUrl('205c37a4087f2971fffbdaae6c6497f5') },
  { lan: 'ai-es', lan_doc: '西班牙语（自动翻译）', subtitle_url: translationUrl('e27202f848d7f1f531cdc7b541b0376a') },
  { lan: 'ai-ar', lan_doc: '阿拉伯语（自动翻译）', subtitle_url: translationUrl('e83b8ddad2cafc8b598ab08dfd519482') },
  { lan: 'ai-pt', lan_doc: '葡萄牙语（自动翻译）', subtitle_url: translationUrl('11076f660a26f319a610c88a237db52c') },
];
const ZH_ORIGINAL: SubtitleTrack = { lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: OWN_URL };
const EN_ORIGINAL: SubtitleTrack = { lan: 'ai-en', lan_doc: '英语（自动生成）', subtitle_url: OWN_URL };
const FOREIGN_ORIGINAL: SubtitleTrack = { lan: 'ai-en', lan_doc: '英语（自动生成）', subtitle_url: FOREIGN_URL };
const ZH_TRANSLATION: SubtitleTrack = {
  lan: 'ai-zh',
  lan_doc: '中文（自动翻译）',
  subtitle_url: translationUrl('e27202f848d7f1f531cdc7b541b0376a'),
};

const CDN_BODY = { body: [{ from: 0, to: 1.5, content: 'first caption' }] };
const ROWS = [{ start: 0, end: 1.5, text: 'first caption' }];

function playerResponse(aid: number | undefined, cid: number, subtitleUrl: string) {
  return playerResponseWithTracks(aid, cid, [{ ...ZH_ORIGINAL, subtitle_url: subtitleUrl }]);
}

function playerResponseWithTracks(aid: number | undefined, cid: number, subtitles: SubtitleTrack[]) {
  return { code: 0, message: '0', data: { aid, cid, subtitle: { subtitles } } };
}

function stubFetch(bodyFor: (url: string) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(bodyFor(String(input))), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Player API calls get `player`; every other URL is the subtitle CDN. */
function stubBilibili(player: unknown) {
  return stubFetch((url) => (url.includes('api.bilibili.com/x/player/') ? player : CDN_BODY));
}

function requestedUrls(fetchMock: ReturnType<typeof stubFetch>): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchSubtitle', () => {
  it('lists tracks from the unsigned x/player/wbi/v2 endpoint', async () => {
    const fetchMock = stubBilibili(playerResponse(REQUEST.aid, REQUEST.cid, OWN_URL));

    await fetchSubtitle(REQUEST.bvid, REQUEST.cid);

    expect(requestedUrls(fetchMock)[0]).toBe(
      `https://api.bilibili.com/x/player/wbi/v2?bvid=${REQUEST.bvid}&cid=${REQUEST.cid}`,
    );
  });

  it.each([
    {
      label: 'an AI track named after another video',
      aid: REQUEST.aid,
      cid: REQUEST.cid,
      url: FOREIGN_URL,
    },
    {
      label: 'an AI track when the player response has no aid (fail closed)',
      aid: undefined,
      cid: REQUEST.cid,
      url: OWN_URL,
    },
    {
      label: 'an AI track whose name merely starts with the requested aid and cid',
      ...PREFIX_OF_OWNER,
      url: OWN_URL,
    },
  ])('refuses $label without touching the CDN', async ({ aid, cid, url }) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = stubBilibili(playerResponse(aid, cid, url));

    const result = await fetchSubtitle(REQUEST.bvid, cid);

    expect(result).toEqual({ status: 'error', rows: [], error: expect.any(String) });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the player API only
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(REQUEST.bvid));
    // Every refused fixture carries a signed `?auth_key=`; the log names the track, not the token.
    expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('auth_key'));
  });

  it.each([
    {
      label: 'an AI track named after the requested video',
      ...REQUEST,
      url: OWN_URL,
      cdnUrl: `https:${OWN_URL}`,
    },
    {
      label: 'an AI track whose md5 tail starts with a digit',
      ...DIGIT_LED,
      cdnUrl: DIGIT_LED.url,
    },
    {
      label: 'an uploader CC track, whose file name names no owner',
      ...REQUEST,
      url: UPLOADER_CC_URL,
      cdnUrl: `https:${UPLOADER_CC_URL}`,
    },
  ])('accepts $label', async ({ bvid, aid, cid, url, cdnUrl }) => {
    const fetchMock = stubBilibili(playerResponse(aid, cid, url));

    const result = await fetchSubtitle(bvid, cid);

    expect(result).toEqual({ status: 'ok', rows: ROWS, source: 'official' });
    expect(requestedUrls(fetchMock)[1]).toBe(cdnUrl);
  });

  it('warns when tracks are withheld from an anonymous request, and still reports no_subtitle', async () => {
    // Shape of the anonymous wbi/v2 answer for a video that does have subtitles (docs/29 §9.1).
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = stubBilibili({
      code: 0,
      message: '0',
      data: { aid: REQUEST.aid, cid: REQUEST.cid, need_login_subtitle: true, subtitle: { subtitles: [] } },
    });

    const result = await fetchSubtitle(REQUEST.bvid, REQUEST.cid);

    expect(result).toEqual({ status: 'no_subtitle', rows: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining(REQUEST.bvid));
  });

  /**
   * A bare md5 file name is a machine translation of the video's original AI
   * track and claims no owner; ownership is judged over every track, so a
   * foreign original still sinks a list whose chosen track claims nothing
   * (docs/29 Step 1b).
   */
  describe('with machine-translated tracks', () => {
    it('accepts a chosen zh translation named by a bare md5 beside an owned original', async () => {
      const fetchMock = stubBilibili(playerResponseWithTracks(REQUEST.aid, REQUEST.cid, [EN_ORIGINAL, ZH_TRANSLATION]));

      const result = await fetchSubtitle(REQUEST.bvid, REQUEST.cid);

      expect(result).toEqual({ status: 'ok', rows: ROWS, source: 'official' });
      expect(requestedUrls(fetchMock)[1]).toBe(`https:${ZH_TRANSLATION.subtitle_url}`);
    });

    it("accepts E1's shape: an owned zh original beside five bare-named translations", async () => {
      const fetchMock = stubBilibili(
        playerResponseWithTracks(REQUEST.aid, REQUEST.cid, [ZH_ORIGINAL, ...E1_TRANSLATIONS]),
      );

      const result = await fetchSubtitle(REQUEST.bvid, REQUEST.cid);

      expect(result).toEqual({ status: 'ok', rows: ROWS, source: 'official' });
      expect(requestedUrls(fetchMock)[1]).toBe(`https:${OWN_URL}`);
    });

    it('refuses the list when another track names another video, though the chosen one names none', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fetchMock = stubBilibili(
        playerResponseWithTracks(REQUEST.aid, REQUEST.cid, [FOREIGN_ORIGINAL, ZH_TRANSLATION]),
      );

      const result = await fetchSubtitle(REQUEST.bvid, REQUEST.cid);

      expect(result).toEqual({ status: 'error', rows: [], error: expect.any(String) });
      expect(fetchMock).toHaveBeenCalledTimes(1); // the player API only
      expect(consoleError).toHaveBeenCalledTimes(1);
      const message = String(consoleError.mock.calls[0][0]);
      expect(message).toContain(REQUEST.bvid);
      expect(message).toContain(FOREIGN_NAME);
      expect(message).not.toContain('auth_key');
    });
  });
});

/**
 * Every Bilibili request carries the browser's own cookie jar and nothing
 * hand-built (docs/29 Step 4). docs/29 E2 showed a Service Worker fetch is
 * already logged in with no init at all, so a hand-written `Cookie` header only
 * ever duplicated the jar — and bet on Chromium letting an extension set a
 * forbidden header.
 */
describe('Bilibili request credentials', () => {
  /**
   * Header names as the caller wrote them, in any of the three `HeadersInit`
   * shapes — `Object.keys` alone reads `['0']` off a tuple array and nothing off a
   * `Headers`. `fetchWithDeadline` spreads the caller's init, so this is the
   * caller's own object (the test env's `Headers` keeps a `Cookie` entry).
   */
  function writtenHeaderNames(init: RequestInit | undefined): string[] {
    const headers = init?.headers;
    if (!headers) return [];
    const names =
      headers instanceof Headers
        ? [...headers.keys()]
        : Array.isArray(headers)
          ? headers.map(([name]) => name)
          : Object.keys(headers);
    return names.map((name) => name.toLowerCase());
  }

  it.each([
    {
      label: 'fetchFavFolders',
      body: { code: 0, message: '0', data: { count: 0, list: [] } },
      call: () => fetchFavFolders({ sessdata: 'SESSION', mid: '1' }),
      requests: 1,
    },
    {
      label: 'fetchFavVideos',
      body: { code: 0, message: '0', data: { has_more: false, medias: [], info: { id: 42, title: 'F', media_count: 0 } } },
      call: () => fetchFavVideos(42),
      requests: 1,
    },
    {
      label: 'fetchSubtitle (player API and CDN)',
      body: undefined,
      call: () => fetchSubtitle(REQUEST.bvid, REQUEST.cid),
      requests: 2,
    },
    {
      label: 'fetchCidByPageList',
      body: { code: 0, message: '0', data: [{ cid: REQUEST.cid, page: 1 }] },
      call: () => fetchCidByPageList(REQUEST.bvid),
      requests: 1,
    },
  ])('$label sends credentials:include and no Cookie header', async ({ body, call, requests }) => {
    const fetchMock =
      body === undefined ? stubBilibili(playerResponse(REQUEST.aid, REQUEST.cid, OWN_URL)) : stubFetch(() => body);

    await call();

    expect(fetchMock).toHaveBeenCalledTimes(requests);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init?.credentials).toBe('include');
      expect(writtenHeaderNames(init)).not.toContain('cookie');
    }
  });
});

/**
 * favbase covers public favorites folders only (user decision 2026-09-22,
 * docs/29 §8 Q5). `attr` bit 0 marks a private folder. Fixture sources
 * (docs/29 §9.5):
 * - attr 0 / 2 / 22 — the only values the dev account's 39 folders carry; a
 *   folder of each value is anonymously readable through `fav/folder/info`,
 *   i.e. public.
 * - attr 1 — a real `list-all` response posted on CSDN (2024-02): the private
 *   default folder.
 * - attr 23 — synthetic, 22 | 1: an ordinary folder turned private.
 */
describe('fetchFavFolders', () => {
  function folder(id: number, attr: number): BiliFavFolder {
    return { id, fid: id, mid: 1, title: `folder ${id}`, media_count: 1, cover: '', intro: '', ctime: 0, mtime: 0, attr, fav_state: 0 };
  }

  it('returns public folders only', async () => {
    const list = [folder(1, 0), folder(2, 2), folder(3, 22), folder(4, 1), folder(5, 23)];
    stubFetch(() => ({ code: 0, message: '0', data: { count: list.length, list } }));

    const folders = await fetchFavFolders({ sessdata: 'SESSION', mid: '1' });

    expect(folders.map((f) => f.id)).toEqual([1, 2, 3]);
  });
});
