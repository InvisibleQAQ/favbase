/**
 * YouTube Data API v3 layer — official endpoints only. Mirrors the role of
 * lib/github/github-api.ts (URL builders, response normalization, structured
 * errors, NO DB imports, NO UI copy — the i18n seam lives at the UI boundary).
 *
 * Fetch model (task 07-18 PRD): public playlists need no OAuth — every call
 * carries the user's Data API key as a `key=` query param. `playlists.list?
 * channelId=` yields the channel's user-created PUBLIC playlists; each
 * playlist's videos come from `playlistItems.list` pagination with per-page
 * `videos.list?id=` detail batch-fill. Playlist item order is POSITION order
 * (user-reorderable), NOT chronological — so there is no safe incremental
 * cutoff: every sync refetches all playlists (insert-only dedupe downstream).
 * Quota is a non-issue (1 unit per call, 10k/day default) — the small
 * inter-page delay is politeness, not anti-detection.
 *
 * NEVER trust a 200 blindly (platform-onboarding error matrix): a 200 body
 * without the expected `items` array throws with a body snippet instead of
 * silently parsing to "0 fetched, success". Exception: `channels.list` omits
 * the `items` key entirely for zero matches — that endpoint opts in to
 * missing-items-as-empty.
 */

import type { CooperativeCheckpoint } from '@/lib/collections';
import { envNumber } from '@/lib/env';
import { sleep } from '@/lib/http/backoff';
import { fetchWithDeadline } from '@/lib/http/fetch-with-deadline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const API_BASE = 'https://www.googleapis.com/youtube/v3';
// API hard maximum for playlists.list / playlistItems.list / videos.list —
// raising the env override past 50 breaks the requests.
const PAGE_SIZE = envNumber('VITE_YOUTUBE_PAGE_SIZE', 50);
/** Polite inter-page delay (quota is ample; this is courtesy, not throttling). */
const PAGE_DELAY_MS = envNumber('VITE_YOUTUBE_PAGE_DELAY_MS', 200);

/** 403 reasons that mean quota/rate limiting (Google sends NO reset header). */
const RATE_LIMIT_REASONS = new Set([
  'quotaExceeded',
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'dailyLimitExceeded',
]);

// ---------------------------------------------------------------------------
// Errors — structured, no UI copy (i18n seam is at the UI boundary)
// ---------------------------------------------------------------------------

export class YoutubeAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'YoutubeAuthError';
  }
}

export class YoutubeRateLimitError extends Error {
  /** When the quota window resets. Google sends no reset header → always null
   *  today (kept in the signature per the platform contract; quota resets at
   *  midnight Pacific). */
  readonly resetAt: Date | null;

  constructor(message: string, resetAt: Date | null = null) {
    super(message);
    this.name = 'YoutubeRateLimitError';
    this.resetAt = resetAt;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Resolved channel — settings-card probe result AND the sync entry point. */
export interface YoutubeChannelInfo {
  channelId: string;
  title: string;
  avatarUrl: string;
}

/** One public playlist of the channel (sources row material). */
export interface YoutubePlaylist {
  playlistId: string;
  title: string;
  /** contentDetails.itemCount — display/progress hint only, not a contract. */
  itemCount: number;
}

/** Playlist membership record — produced for EVERY playlist entry, including
 *  videos already known to the DB (they still need an item_sources link). */
export interface PlaylistEntry {
  videoId: string;
  /** `snippet.publishedAt` = "date added to playlist" (official semantics). */
  addedAt: string;
  /** `contentDetails.videoPublishedAt` (ISO), may be '' for deleted videos. */
  videoPublishedAt: string;
}

/** Normalized video with details — only produced for ids passing `needsDetails`. */
export interface YoutubePlaylistVideo {
  videoId: string;
  title: string;
  /** Full description (sync service truncates for platformMeta, stores full in item_contents). */
  description: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string;
  durationSeconds: number;
  viewCount: number;
  likeCount: number;
  /** ISO — when the video was added to the playlist it was first seen in. */
  addedAt: string;
  /** Video publish time (ISO) — contentDetails.videoPublishedAt, falling back to videos.list snippet. */
  videoPublishedAt: string;
}

export interface FetchPlaylistItemsOptions {
  /** Return false to skip the videos.list detail fill for an id (already
   *  stored / already fetched this run). Membership entries are ALWAYS kept. */
  needsDetails?: (videoId: string) => boolean;
  /** Fired after each fetched page with the cumulative entry count. */
  onPage?: (page: number, entryCount: number) => void;
  control?: CooperativeCheckpoint;
}

export interface PlaylistItemsResult {
  /** All memberships in playlist order (links material). */
  entries: PlaylistEntry[];
  /** Details for the subset that passed `needsDetails` AND had a videos.list
   *  row (deleted/private videos have none and are skipped). */
  videos: YoutubePlaylistVideo[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * ISO-8601 duration → seconds. YouTube emits `PT#H#M#S` (long streams may use
 * a day component, live/premiere placeholders send `P0D`). Unparseable /
 * missing input → 0.
 */
export function parseIso8601Duration(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return 0;
  const [, d, h, min, s] = m;
  return (
    Number(d ?? 0) * 86400 + Number(h ?? 0) * 3600 + Number(min ?? 0) * 60 + Number(s ?? 0)
  );
}

const CHANNEL_ID_RE = /^UC[0-9A-Za-z_-]{22}$/;

/**
 * Raw settings input → channels.list filter. Accepts `@handle`, a bare
 * handle, a `UC…` channel id, or a youtube.com URL containing either
 * (`youtube.com/@handle`, `youtube.com/channel/UC…`). The `@` on handles is
 * optional for the API, so it's passed through as typed.
 */
export function parseChannelInput(
  raw: string,
): { kind: 'id' | 'handle'; value: string } | null {
  let input = raw.trim();
  if (!input) return null;

  // Strip a youtube.com URL prefix down to its first path segment.
  const url = /^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com(?:\/(.*))?$/i.exec(input);
  if (url) {
    input = url[1] ?? '';
    if (input.startsWith('channel/')) input = input.slice('channel/'.length);
    input = input.split(/[/?#]/)[0] ?? '';
    if (!input) return null;
  }

  if (CHANNEL_ID_RE.test(input)) return { kind: 'id', value: input };
  return { kind: 'handle', value: input };
}

// ---------------------------------------------------------------------------
// Raw response shapes — only the fields we consume (never `any`)
// ---------------------------------------------------------------------------

interface RawThumbnails {
  default?: { url?: string };
  medium?: { url?: string };
  high?: { url?: string };
}

interface RawChannelsResponse {
  items?: {
    id?: string;
    snippet?: { title?: string; thumbnails?: RawThumbnails };
  }[];
}

interface RawPlaylist {
  id?: string;
  snippet?: { title?: string };
  contentDetails?: { itemCount?: number };
}

interface RawPlaylistsResponse {
  items?: RawPlaylist[];
  nextPageToken?: string;
}

interface RawPlaylistItem {
  snippet?: {
    /** Date the item was added to the playlist. */
    publishedAt?: string;
    resourceId?: { videoId?: string };
  };
  contentDetails?: {
    videoId?: string;
    videoPublishedAt?: string;
  };
}

interface RawPlaylistItemsResponse {
  items?: RawPlaylistItem[];
  nextPageToken?: string;
}

interface RawVideo {
  id?: string;
  snippet?: {
    publishedAt?: string;
    title?: string;
    description?: string;
    channelId?: string;
    channelTitle?: string;
    thumbnails?: RawThumbnails;
  };
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string; likeCount?: string };
}

interface RawVideosResponse {
  items?: RawVideo[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Prefer `medium` (320x180 — card-sized), fall back high → default → ''. */
function pickThumbnail(thumbs: RawThumbnails | undefined): string {
  return thumbs?.medium?.url ?? thumbs?.high?.url ?? thumbs?.default?.url ?? '';
}

function toCount(value: string | undefined): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** All `error.errors[].reason` strings from a Google error body ('' filtered). */
function extractErrorReasons(rawBody: string): string[] {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { errors?: { reason?: string }[] } };
    return (parsed.error?.errors ?? []).map((e) => e.reason ?? '').filter(Boolean);
  } catch {
    return [];
  }
}

function buildUrl(endpoint: string, apiKey: string, params: Record<string, string>): string {
  const search = new URLSearchParams(params);
  search.set('key', apiKey);
  return `${API_BASE}/${endpoint}?${search.toString()}`;
}

/**
 * GET with structured error classification for the API-key auth model:
 * - 400/403 with a `keyInvalid` reason (or Google's "API key not valid"
 *   message) → YoutubeAuthError — the key is bad, re-configure.
 * - 403 with a quota reason / 429 → YoutubeRateLimitError (resetAt null —
 *   Google sends no reset header).
 * - 200 body without an `items` array is thrown with a snippet, never
 *   returned as an empty result — unless `allowMissingItems` (channels.list
 *   legitimately omits `items` for zero matches).
 */
async function apiFetch(
  url: string,
  opts: { allowMissingItems?: boolean } = {},
): Promise<unknown> {
  const res = await fetchWithDeadline(url, { headers: { Accept: 'application/json' } });
  const rawBody = await res.text();

  if (res.status === 400 || res.status === 403) {
    const reasons = extractErrorReasons(rawBody);
    if (reasons.includes('keyInvalid') || rawBody.includes('API key not valid')) {
      throw new YoutubeAuthError('YouTube API rejected the API key — re-configure');
    }
    if (res.status === 403) {
      const quotaReason = reasons.find((r) => RATE_LIMIT_REASONS.has(r));
      if (quotaReason) {
        throw new YoutubeRateLimitError(`YouTube API rate limited (403, ${quotaReason})`, null);
      }
    }
    throw new Error(`YouTube API HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
  }

  if (res.status === 429) {
    throw new YoutubeRateLimitError('YouTube API rate limited (429)', null);
  }

  if (!res.ok) {
    throw new Error(`YouTube API HTTP ${res.status}: ${rawBody.slice(0, 300)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    throw new Error(`YouTube API 200 with non-JSON body: ${rawBody.slice(0, 300)}`);
  }

  // 200 must carry the `items` array (may be empty — a legit zero result).
  // Anything else is a silently-degraded contract → throw, don't return [].
  if (!Array.isArray((json as { items?: unknown }).items)) {
    if (opts.allowMissingItems) return { items: [] };
    throw new Error(
      `unexpected YouTube response shape (no items array): ${rawBody.slice(0, 300)}`,
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

/**
 * Resolve the user's channel input (@handle / UC… id / channel URL) to a
 * channel via `channels.list`. Doubles as the settings-card "test connection"
 * probe (title + avatar for the success Alert). No match → plain Error (the
 * UI maps it to a "channel not found" message).
 */
export async function resolveChannel(apiKey: string, input: string): Promise<YoutubeChannelInfo> {
  const parsed = parseChannelInput(input);
  if (!parsed) {
    throw new Error('empty channel input');
  }

  const params: Record<string, string> = { part: 'snippet' };
  params[parsed.kind === 'id' ? 'id' : 'forHandle'] = parsed.value;
  const json = (await apiFetch(buildUrl('channels', apiKey, params), {
    allowMissingItems: true,
  })) as RawChannelsResponse;

  const item = json.items?.[0];
  if (!item?.id) {
    throw new Error(`YouTube channel not found for input: ${parsed.value}`);
  }
  return {
    channelId: item.id,
    title: item.snippet?.title ?? '',
    avatarUrl: pickThumbnail(item.snippet?.thumbnails),
  };
}

/**
 * All user-created PUBLIC playlists of a channel via serial `playlists.list?
 * channelId=` pagination (API-key access only ever sees public ones —
 * exactly the product scope). Saved third-party playlists have NO official
 * endpoint and are out of scope.
 */
export async function fetchPlaylists(
  apiKey: string,
  channelId: string,
  control?: CooperativeCheckpoint,
): Promise<YoutubePlaylist[]> {
  const all: YoutubePlaylist[] = [];
  let pageToken: string | undefined;

  while (true) {
    await control?.checkpoint();
    const params: Record<string, string> = {
      part: 'snippet,contentDetails',
      channelId,
      maxResults: String(PAGE_SIZE),
    };
    if (pageToken) params.pageToken = pageToken;

    const json = (await apiFetch(buildUrl('playlists', apiKey, params))) as RawPlaylistsResponse;

    for (const item of json.items ?? []) {
      if (!item.id) continue;
      all.push({
        playlistId: item.id,
        title: item.snippet?.title ?? '',
        itemCount: item.contentDetails?.itemCount ?? 0,
      });
    }

    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
    await sleep(PAGE_DELAY_MS);
  }

  return all;
}

function mapPlaylistItem(item: RawPlaylistItem): PlaylistEntry | null {
  const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
  if (!videoId) return null;
  return {
    videoId,
    addedAt: item.snippet?.publishedAt ?? '',
    videoPublishedAt: item.contentDetails?.videoPublishedAt ?? '',
  };
}

function mergeVideo(entry: PlaylistEntry, detail: RawVideo): YoutubePlaylistVideo {
  return {
    videoId: entry.videoId,
    title: detail.snippet?.title ?? '',
    description: detail.snippet?.description ?? '',
    channelId: detail.snippet?.channelId ?? '',
    channelTitle: detail.snippet?.channelTitle ?? '',
    thumbnailUrl: pickThumbnail(detail.snippet?.thumbnails),
    durationSeconds: parseIso8601Duration(detail.contentDetails?.duration),
    viewCount: toCount(detail.statistics?.viewCount),
    likeCount: toCount(detail.statistics?.likeCount),
    addedAt: entry.addedAt,
    videoPublishedAt: entry.videoPublishedAt || (detail.snippet?.publishedAt ?? ''),
  };
}

/**
 * One playlist's full contents via serial `playlistItems.list` pagination.
 * EVERY entry is returned as a membership record (links are needed even for
 * already-known videos); the `videos.list` detail fill runs only for ids
 * passing `needsDetails` (dedupe across playlists/DB is the caller's set).
 * Videos missing from the details response (deleted/private) yield an entry
 * but no video — the sync layer naturally skips linking rows it can't create.
 * Full refetch by design: playlist order is position order, so there is no
 * safe stop-on-known-id cutoff (unlike the old LL liked-videos model).
 */
export async function fetchPlaylistItems(
  apiKey: string,
  playlistId: string,
  opts: FetchPlaylistItemsOptions = {},
): Promise<PlaylistItemsResult> {
  const entries: PlaylistEntry[] = [];
  const videos: YoutubePlaylistVideo[] = [];
  let pageToken: string | undefined;
  let page = 0;

  while (true) {
    await opts.control?.checkpoint();
    page += 1;
    const params: Record<string, string> = {
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: String(PAGE_SIZE),
    };
    if (pageToken) params.pageToken = pageToken;

    const json = (await apiFetch(
      buildUrl('playlistItems', apiKey, params),
    )) as RawPlaylistItemsResponse;

    const pageEntries = (json.items ?? [])
      .map(mapPlaylistItem)
      .filter((e): e is PlaylistEntry => e !== null);
    entries.push(...pageEntries);

    const detailTargets = pageEntries.filter(
      (e) => opts.needsDetails?.(e.videoId) ?? true,
    );
    if (detailTargets.length > 0) {
      // One page is ≤ 50 ids = one videos.list call. No maxResults alongside
      // `id` (the docs mark it unsupported there).
      const detailJson = (await apiFetch(
        buildUrl('videos', apiKey, {
          id: detailTargets.map((e) => e.videoId).join(','),
          part: 'snippet,contentDetails,statistics',
        }),
      )) as RawVideosResponse;
      const detailById = new Map<string, RawVideo>();
      for (const v of detailJson.items ?? []) {
        if (v.id) detailById.set(v.id, v);
      }
      for (const e of detailTargets) {
        const detail = detailById.get(e.videoId);
        if (!detail) continue; // deleted / private — no details available, skip
        videos.push(mergeVideo(e, detail));
      }
    }

    opts.onPage?.(page, entries.length);

    if (pageEntries.length === 0 || !json.nextPageToken) break;
    pageToken = json.nextPageToken;
    await sleep(PAGE_DELAY_MS);
  }

  return { entries, videos };
}
