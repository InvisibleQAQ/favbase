/**
 * Bilibili API layer — all B站 API calls consolidated here.
 * Internal: URL builders, response validation.
 * Adding a new API: add a function here + types in types.ts.
 *
 * Login state: every request goes out with `credentials: 'include'` and no
 * hand-built `Cookie` header. The browser attaches the bilibili cookie jar in
 * every context we run in — the Content Script is same-site, and the
 * extension's host permission makes app.html and the Background SW send it
 * too (docs/29 E2: a SW fetch was logged in even with no init at all).
 */

import type { SubtitleResult, SubtitleRow } from '@/lib/subtitle/types';
import { fetchWithDeadline } from '@/lib/http/fetch-with-deadline';
import type { BiliAuthInfo, BiliFavFolder, BiliFavOrder, BiliFavVideoListResponse, DashAudioStream, SubtitleTrack } from './types';

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

const ENDPOINTS = {
  pageList: (bvid: string) =>
    `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
  // Not the non-wbi x/player/v2: it serves logged-in requests other videos' AI subtitles
  // (docs/29 C1). wbi/v2 answers without a w_rid signature (docs/29 F8/F9), so none is sent.
  playerWbiV2: (bvid: string, cid: number) =>
    `https://api.bilibili.com/x/player/wbi/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`,
  playUrl: (bvid: string, cid: number) =>
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}&fnval=16&fnver=0&platform=html5&high_quality=1&otype=json`,
  favFolderListAll: (mid: string) =>
    `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}`,
  favResourceList: (mediaId: number, pn: number, ps: number = 20, order: BiliFavOrder = 'mtime', keyword: string = '') => {
    const base = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(String(mediaId))}&pn=${encodeURIComponent(String(pn))}&ps=${encodeURIComponent(String(ps))}&order=${order}&platform=web`;
    // type=0 pins the search to the current folder (vs 1 = all folders).
    return keyword ? `${base}&type=0&keyword=${encodeURIComponent(keyword)}` : base;
  },
} as const;

const BILI_COOKIE_URL = 'https://www.bilibili.com';

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class BiliAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BiliAuthError';
  }
}

// ---------------------------------------------------------------------------
// Auth — requires chrome.cookies (Extension Page / Background SW)
// ---------------------------------------------------------------------------

/**
 * Read SESSDATA + DedeUserID from bilibili cookies. Returns null if missing or expired.
 * A no-network login check and the source of `mid` — never copied into a request header.
 */
export async function getBiliAuth(): Promise<BiliAuthInfo | null> {
  const [sessdataCookie, midCookie] = await Promise.all([
    chrome.cookies.get({ url: BILI_COOKIE_URL, name: 'SESSDATA' }),
    chrome.cookies.get({ url: BILI_COOKIE_URL, name: 'DedeUserID' }),
  ]);

  if (!sessdataCookie?.value || !midCookie?.value) return null;

  const now = Date.now() / 1000;
  if (sessdataCookie.expirationDate && sessdataCookie.expirationDate < now) {
    return null;
  }

  return {
    sessdata: sessdataCookie.value,
    mid: midCookie.value,
  };
}

// ---------------------------------------------------------------------------
// Favorites — logged-in listing (Extension Page / Background SW)
// ---------------------------------------------------------------------------

interface BiliFavFolderListResponse {
  code: number;
  message: string;
  data: {
    count: number;
    list: BiliFavFolder[];
  } | null;
}

/**
 * favbase covers public folders only (user decision 2026-09-22, docs/29 §8 Q5);
 * `attr` bit 0 marks a private one. Evidence (docs/29 §9.5): eight independent
 * clients test `attr & 1`, a real `list-all` response shows the private default
 * folder as `attr: 1`, and all 39 folders of the dev account (attr 0 / 2 / 22)
 * have it clear; a folder of each value is anonymously readable. Wrong in the
 * other direction, a private folder would slip through — today's behavior —
 * never a public one lost.
 */
function isPublicFolder(folder: BiliFavFolder): boolean {
  return (folder.attr & 1) === 0;
}

/**
 * Fetch the logged-in user's public favorite folders. Needs the login state:
 * an anonymous `list-all` returns `data: null`, not the public folders.
 * `auth.mid` names whose folders to list.
 */
export async function fetchFavFolders(
  auth: BiliAuthInfo,
): Promise<BiliFavFolder[]> {
  const url = ENDPOINTS.favFolderListAll(auth.mid);
  const res = await fetchWithDeadline(url, { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Bilibili API HTTP ${res.status}`);
  }

  const json: BiliFavFolderListResponse = await res.json();

  if (json.code === -101) {
    throw new BiliAuthError('SESSDATA expired or invalid');
  }

  if (json.code !== 0) {
    throw new Error(`Bilibili API error ${json.code}: ${json.message}`);
  }

  return (json.data?.list ?? []).filter(isPublicFolder);
}

/** Fetch paginated video list for a favorite folder. A non-empty keyword
 *  searches video titles within that folder (server-side, type=0). */
export async function fetchFavVideos(
  mediaId: number,
  page: number = 1,
  ps: number = 20,
  order: BiliFavOrder = 'mtime',
  keyword: string = '',
): Promise<BiliFavVideoListResponse> {
  const url = ENDPOINTS.favResourceList(mediaId, page, ps, order, keyword);
  const res = await fetchWithDeadline(url, { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Bilibili API HTTP ${res.status}`);
  }

  const json = await res.json();

  if (json.code === -101) {
    throw new BiliAuthError('SESSDATA expired or invalid');
  }

  if (json.code !== 0) {
    throw new Error(`Bilibili API error ${json.code}: ${json.message}`);
  }

  return json.data;
}

// ---------------------------------------------------------------------------
// Subtitle — Content Script and Background SW alike
// ---------------------------------------------------------------------------

const AI_SUBTITLE_NAME = /\/bfs\/ai_subtitle\/prod\/([^/?]+)/;
/** A whole machine-translation file name, or what follows `{aid}{cid}` in an original's. */
const MD5_HEX = /^[0-9a-f]{32}$/i;

/**
 * An original AI track is named `{aid}{cid}{md5}`; any other prefix is another video's.
 * Two kinds name no owner and pass: uploader CC (/bfs/subtitle/<hash>.json) and B站's
 * machine translations of the original, whose name is a bare md5 (docs/29 Step 1b).
 */
function ownsSubtitleUrl(url: string, aid: unknown, cid: number): boolean {
  const name = AI_SUBTITLE_NAME.exec(url)?.[1];
  if (!name || MD5_HEX.test(name)) return true;
  const owner = `${aid}${cid}`;
  return name.startsWith(owner) && MD5_HEX.test(name.slice(owner.length));
}

/**
 * Fetch bilibili AI subtitles via player API + CDN.
 * Refuses the whole response (status 'error', CDN never requested) when any track's file
 * name belongs to another video, not only the chosen one: a foreign response can hand us
 * a translation that names no owner beside an original that names someone else.
 * A list in which no track names an owner (only bare names or uploader CC) passes, foreign
 * or not: the cost of passing bare names (docs/29 Step 1b「残留」).
 */
export async function fetchSubtitle(
  bvid: string,
  cid: number,
): Promise<SubtitleResult> {
  const playerUrl = ENDPOINTS.playerWbiV2(bvid, cid);
  const playerRes = await fetchWithDeadline(playerUrl, { credentials: 'include' });

  if (!playerRes.ok) {
    return { status: 'error', rows: [], error: `Player API HTTP ${playerRes.status}` };
  }

  const playerData = await playerRes.json();

  if (playerData?.code !== 0) {
    const code = playerData?.code ?? 'unknown';
    const msg = playerData?.message ?? '';
    return { status: 'error', rows: [], error: `Player API code ${code}: ${msg}` };
  }

  const subtitles: SubtitleTrack[] | undefined = playerData?.data?.subtitle?.subtitles;

  if (!subtitles?.length) {
    // B站 has tracks but withholds them from anonymous requests. Still no_subtitle (the
    // caller falls back to ASR); whether to tell the user is open (docs/29 §8 Q4).
    if (playerData?.data?.need_login_subtitle === true) {
      console.warn(`[bilibili-api] Subtitles for ${bvid} need a logged-in request (need_login_subtitle)`);
    }
    return { status: 'no_subtitle', rows: [] };
  }

  const aid = playerData?.data?.aid;
  const foreignUrl = subtitles
    .map((s) => s.subtitle_url?.trim())
    .find((url) => url && !ownsSubtitleUrl(url, aid, cid));
  if (foreignUrl) {
    console.error(
      `[bilibili-api] Refusing subtitle for ${bvid}: requested aid ${aid} cid ${cid}, track is ${foreignUrl.split('?')[0]}`,
    );
    return { status: 'error', rows: [], error: 'Subtitle track belongs to another video' };
  }

  const zhTrack = subtitles.find((s) => s.lan_doc.includes('中文')) ?? subtitles[0];
  const rawUrl = zhTrack.subtitle_url?.trim();

  if (!rawUrl) {
    return { status: 'no_subtitle', rows: [] };
  }

  const subtitleUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  const subRes = await fetchWithDeadline(subtitleUrl, { credentials: 'include' });

  if (!subRes.ok) {
    return { status: 'error', rows: [], error: `Subtitle CDN HTTP ${subRes.status}` };
  }

  const subData = await subRes.json();

  const body: unknown[] =
    subData?.body ?? subData?.data?.body ?? subData?.content ?? subData?.result?.body ?? (Array.isArray(subData) ? subData : []);

  if (!Array.isArray(body) || body.length === 0) {
    return { status: 'no_subtitle', rows: [] };
  }

  const rows: SubtitleRow[] = body.map(
    (item: unknown) => {
      const entry = item as { from: number; to: number; content: string };
      return {
        start: entry.from,
        end: entry.to,
        text: entry.content,
      };
    },
  );

  return { status: 'ok', rows, source: 'official' };
}

// ---------------------------------------------------------------------------
// Video info — Content Script and Background SW alike
// ---------------------------------------------------------------------------

/** Fetch CID for a video page via pagelist API. Works from any extension context. */
export async function fetchCidByPageList(bvid: string, pageNum: number = 1): Promise<number> {
  const url = ENDPOINTS.pageList(bvid);
  const res = await fetchWithDeadline(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Pagelist API HTTP ${res.status}`);
  const json = await res.json();
  const pages: { cid: number; page: number }[] = json?.data ?? [];
  if (!pages.length) throw new Error(`No pages for ${bvid}`);
  const page = pages[pageNum - 1] ?? pages[0];
  return page.cid;
}

// ---------------------------------------------------------------------------
// Play URL / DASH — Content Script (credentials: include)
// ---------------------------------------------------------------------------

export interface DashManifest {
  audio: DashAudioStream[];
}

/** Fetch DASH manifest from playurl API. Content Script context. */
export async function fetchPlayUrl(bvid: string, cid: number): Promise<DashManifest> {
  const url = ENDPOINTS.playUrl(bvid, cid);
  const res = await fetchWithDeadline(url, { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`playurl API failed: HTTP ${res.status}`);
  }

  const json = await res.json();

  if (Number(json?.code ?? 0) !== 0) {
    throw new Error(`playurl API returned error: ${String(json?.message || 'unknown')}`);
  }

  const dash = json?.data?.dash;

  if (!dash?.audio?.length) {
    throw new Error('No audio tracks found in DASH manifest');
  }

  return { audio: dash.audio };
}

/** Extract the best audio stream URL from a bilibili video's DASH manifest. */
export async function extractBiliAudioUrl(
  bvid: string,
  cid: number,
): Promise<string> {
  const dash = await fetchPlayUrl(bvid, cid);
  const streams = [...dash.audio].sort(
    (a: DashAudioStream, b: DashAudioStream) =>
      (b.bandwidth ?? 0) - (a.bandwidth ?? 0),
  );
  const first = streams[0];
  const url = first.baseUrl ?? first.base_url;
  if (!url) throw new Error('Audio track URL is empty in DASH manifest');
  return url;
}
