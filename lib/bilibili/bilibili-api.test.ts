import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchSubtitle } from './bilibili-api';

/**
 * `fetchSubtitle` must never hand back another video's subtitle (docs/29 C1/C4):
 * the non-wbi `x/player/v2` serves logged-in requests tracks that belong to
 * other videos, and B站 names every AI subtitle file `{aid}{cid}{md5}`.
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

const CDN_BODY = { body: [{ from: 0, to: 1.5, content: 'first caption' }] };
const ROWS = [{ start: 0, end: 1.5, text: 'first caption' }];

function playerResponse(aid: number | undefined, cid: number, subtitleUrl: string) {
  return {
    code: 0,
    message: '0',
    data: {
      aid,
      cid,
      subtitle: {
        subtitles: [{ lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: subtitleUrl }],
      },
    },
  };
}

/** Player API calls get `player`; every other URL is the subtitle CDN. */
function stubBilibili(player: unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const body = String(input).includes('api.bilibili.com/x/player/') ? player : CDN_BODY;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function requestedUrls(fetchMock: ReturnType<typeof stubBilibili>): string[] {
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
});
