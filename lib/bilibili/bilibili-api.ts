/**
 * Bilibili API layer — all B站 API calls consolidated here.
 * Internal: URL builders, response validation, auth.
 * Adding a new API: add a function here + types in types.ts.
 */

import type { SubtitleResult, SubtitleRow } from '../transcription/types';
import type { BiliAuthInfo, BiliFavFolder, BiliFavVideoListResponse, DashAudioStream, SubtitleTrack } from './types';

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

const ENDPOINTS = {
  pageList: (bvid: string) =>
    `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
  playerV2: (bvid: string, cid: number) =>
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`,
  playUrl: (bvid: string, cid: number) =>
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}&fnval=16&fnver=0&platform=html5&high_quality=1&otype=json`,
  favFolderListAll: (mid: string) =>
    `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}`,
  favResourceList: (mediaId: number, pn: number, ps: number = 20) =>
    `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(String(mediaId))}&pn=${encodeURIComponent(String(pn))}&ps=${encodeURIComponent(String(ps))}&platform=web`,
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

/** Read SESSDATA + DedeUserID from bilibili cookies. Returns null if missing or expired. */
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
// Favorites — requires explicit auth (Extension Page / Background SW)
// ---------------------------------------------------------------------------

interface BiliFavFolderListResponse {
  code: number;
  message: string;
  data: {
    count: number;
    list: BiliFavFolder[];
  } | null;
}

/** Fetch all favorite folders for the authenticated user. */
export async function fetchFavFolders(
  auth: BiliAuthInfo,
): Promise<BiliFavFolder[]> {
  const url = ENDPOINTS.favFolderListAll(auth.mid);
  const res = await fetch(url, {
    headers: { Cookie: `SESSDATA=${auth.sessdata}` },
  });

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

  return json.data?.list ?? [];
}

/** Fetch paginated video list for a favorite folder. */
export async function fetchFavVideos(
  auth: BiliAuthInfo,
  mediaId: number,
  page: number = 1,
  ps: number = 20,
): Promise<BiliFavVideoListResponse> {
  const url = ENDPOINTS.favResourceList(mediaId, page, ps);
  const res = await fetch(url, {
    headers: { Cookie: `SESSDATA=${auth.sessdata}` },
  });

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
// Subtitle — Content Script (credentials: include) or Extension Page (explicit auth)
// ---------------------------------------------------------------------------

function buildFetchInit(auth?: BiliAuthInfo): RequestInit {
  if (auth) return { headers: { Cookie: `SESSDATA=${auth.sessdata}` } };
  return { credentials: 'include' };
}

/**
 * Fetch bilibili AI subtitles via player API + CDN.
 * Content Script: omit auth (uses same-origin cookies).
 * Extension Page: pass auth for explicit Cookie header.
 */
export async function fetchSubtitle(
  bvid: string,
  cid: number,
  auth?: BiliAuthInfo,
): Promise<SubtitleResult> {
  const playerUrl = ENDPOINTS.playerV2(bvid, cid);
  const playerRes = await fetch(playerUrl, buildFetchInit(auth));

  if (!playerRes.ok) {
    return { status: 'error', rows: [], error: `Player API HTTP ${playerRes.status}` };
  }

  const playerData = await playerRes.json();
  const subtitles: SubtitleTrack[] | undefined = playerData?.data?.subtitle?.subtitles;

  if (!subtitles?.length) {
    return { status: 'no_subtitle', rows: [] };
  }

  const zhTrack = subtitles.find((s) => s.lan_doc.includes('中文')) ?? subtitles[0];
  const rawUrl = zhTrack.subtitle_url?.trim();

  if (!rawUrl) {
    return { status: 'no_subtitle', rows: [] };
  }

  const subtitleUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  const subRes = await fetch(subtitleUrl, buildFetchInit(auth));

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

  return { status: 'ok', rows, source: 'bilibili' };
}

// ---------------------------------------------------------------------------
// Video info — Content Script (credentials: include) or Extension Page (auth)
// ---------------------------------------------------------------------------

/** Fetch CID for a video page via pagelist API. Works from any extension context. */
export async function fetchCidByPageList(bvid: string, pageNum: number = 1, auth?: BiliAuthInfo): Promise<number> {
  const url = ENDPOINTS.pageList(bvid);
  const res = await fetch(url, buildFetchInit(auth));
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
  const res = await fetch(url, { credentials: 'include' });

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
