/**
 * X (Twitter) "API" layer — reads the user's bookmarks from X's PRIVATE
 * GraphQL endpoint by replaying the logged-in web client's own request
 * (headers captured by the background webRequest listener, see x-auth.ts).
 * Mirrors the role of lib/github/github-api.ts + lib/bilibili/bilibili-api.ts
 * (URL builders, response normalization, structured errors, NO DB imports, NO
 * UI copy — the i18n seam lives at the UI boundary).
 *
 * Request construction mirrors supermemory's browser-extension (utils/
 * twitter-utils.ts): a hardcoded `Bookmarks` queryId + a static `features`
 * object, `variables = {count, includePromotedContent:false, cursor?}`, and NO
 * `fieldToggles`. Auth is the FULL captured `Cookie` + `x-csrf-token` +
 * `authorization` replayed verbatim (see x-auth.ts for why the old
 * `chrome.cookies.get(auth_token, ct0)` approach returned nothing).
 *
 * No DNR / Origin / Referer tricks (supermemory has none and works): a
 * host-permitted extension-context fetch gets same-site treatment (no
 * browser-set Origin) and Chromium never sends chrome-extension:// referrers
 * to web origins. The fetch also passes NO `credentials` option — 'omit'
 * strips the Cookie header (see fetchPageWithBackoff).
 *
 * Pure helpers (parseTweets / extractBottomCursor / mapTweetToRow /
 * buildBookmarksUrl) are exported for unit tests.
 */

import type { XAuth } from './x-auth';
import type { CooperativeCheckpoint } from '@/lib/collections';
import { fetchWithDeadline } from '@/lib/http/fetch-with-deadline';

// Auth lives in x-auth.ts (session-storage-backed capture); re-export so the
// sync service keeps a single `./x-api` import surface.
export { getXAuth, type XAuth } from './x-auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GRAPHQL_BASE = 'https://x.com/i/api/graphql';
const BOOKMARKS_OPERATION = 'Bookmarks';

/**
 * The `Bookmarks` list-all queryId. Hardcoded (mirrors supermemory) — X rotates
 * queryIds per web release, but stale ids empirically keep working server-side
 * for this operation. NOT `BookmarkSearchTimeline` (that's the SEARCH op, whose
 * server-validated `querySource` enum rejects the list-all use case). If a sync
 * throws a 404/queryId error, refresh this from a live x.com bookmarks request.
 */
const BOOKMARKS_QUERY_ID = 'xLjCVTqYWz8CGSprLU349w';

/**
 * Static `features` map for the Bookmarks operation (verbatim from supermemory
 * utils/twitter-utils.ts TWITTER_API_FEATURES). Every key the operation
 * declares must be present (a missing key is an HTTP 400 "features cannot be
 * null"); values only shape the response. Paired with BOOKMARKS_QUERY_ID above
 * — refresh both together if X starts rejecting the request.
 */
const TWITTER_API_FEATURES: Record<string, boolean> = {
  graphql_timeline_v2_bookmark_timeline: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_media_download_video_enabled: false,
  responsive_web_text_conversations_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: true,
  view_counts_everywhere_api_enabled: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  responsive_web_edit_tweet_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  articles_preview_enabled: true,
  rweb_video_timestamps_enabled: true,
  verified_phone_label_enabled: true,
};

// --- Anti-detection pacing constants (research/anti-detection-strategy.md §2) ---
/** Rows per page. supermemory uses 100 (fewer requests → faster full sync). */
const PAGE_SIZE = 100;
/** Per-page base delay before the next request. */
const BASE_DELAY_MS = 1000;
/** Added as `Math.random() * JITTER_MS` to simulate human scroll cadence. */
const JITTER_MS = 500;
/** Pause until reset when `x-rate-limit-remaining` drops to/below this. */
const REMAINING_STOP_THRESHOLD = 3;
/** Cap exponential backoff for transient 5xx — never loop forever. */
const MAX_RETRIES = 5;
/** Base for `base * 2^n + jitter` transient backoff. */
const BACKOFF_BASE_MS = 1000;
/** Floor when `x-rate-limit-reset` is in the past (clock skew). */
const MIN_SLEEP_ON_RESET_MS = 1000;

/** Appended to thrown error messages so a live failure names the queryId used. */
const DIAG_SUFFIX = ` [queryId=${BOOKMARKS_QUERY_ID}]`;

// ---------------------------------------------------------------------------
// Errors — structured, no UI copy (i18n seam is at the UI boundary)
// ---------------------------------------------------------------------------

/**
 * Why auth failed — the two modes need different user actions:
 * - 'no-token': nothing captured yet (session storage empty) → refresh x.com
 *   so the web client fires an API request the webRequest listener can capture.
 * - 'rejected': we HAD tokens but X returned 401/403 → the session is stale or
 *   the replay is broken → re-login to x.com / re-capture.
 */
export type XAuthFailReason = 'no-token' | 'rejected';

export class XAuthError extends Error {
  readonly reason: XAuthFailReason;

  constructor(message: string, reason: XAuthFailReason) {
    super(message);
    this.name = 'XAuthError';
    this.reason = reason;
  }
}

export class XRateLimitError extends Error {
  /** When the rate-limit window resets (from x-rate-limit-reset), null if absent. */
  readonly resetAt: Date | null;

  constructor(message: string, resetAt: Date | null) {
    super(message);
    this.name = 'XRateLimitError';
    this.resetAt = resetAt;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Media attached to a bookmarked tweet (photo/video/animated_gif). */
export interface XMedia {
  type: string;
  url: string;
}

/** Normalized bookmark row — the fetch layer's output contract (no DB shape). */
export interface XRawBookmark {
  /** tweet rest_id */
  id: string;
  text: string;
  /** ISO/twitter date string (created_at) */
  createdAt: string;
  author: { handle: string; name: string; avatarUrl: string; restId: string };
  media: XMedia[];
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  lang: string;
  /** https://x.com/{handle}/status/{id} */
  url: string;
}

/** Progress callback fired after each fetched page. */
export type BookmarksProgressCallback = (fetchedCount: number, page: number) => void;

export interface FetchBookmarksOptions {
  /** Incremental stop: return true when a known (already-stored) id is hit. */
  shouldStop?: (tweetId: string) => boolean;
  control?: CooperativeCheckpoint;
}

// ---------------------------------------------------------------------------
// URL / header builders (pure where possible)
// ---------------------------------------------------------------------------

/**
 * Build the Bookmarks GET URL. Variables mirror the real bookmarks page:
 * `{count, includePromotedContent:false}` + cursor from page 2 on. `features`
 * carries the full static map the operation declares (missing keys are an HTTP
 * 400, not "false"); NO fieldToggles (supermemory omits them). Pure — exported
 * for unit tests.
 */
export function buildBookmarksUrl(opts: { count?: number; cursor?: string } = {}): string {
  const variables: Record<string, unknown> = {
    count: opts.count ?? PAGE_SIZE,
    includePromotedContent: false,
  };
  if (opts.cursor) variables.cursor = opts.cursor;

  const params = new URLSearchParams({
    features: JSON.stringify(TWITTER_API_FEATURES),
    variables: JSON.stringify(variables),
  });
  return `${GRAPHQL_BASE}/${BOOKMARKS_QUERY_ID}/${BOOKMARKS_OPERATION}?${params.toString()}`;
}

/**
 * Replay the captured web-client headers verbatim (mirrors supermemory
 * createTwitterAPIHeaders). Chrome lets extension contexts (with host
 * permission) set the otherwise-forbidden Cookie header. No Origin/Referer
 * games needed: host-permitted extension fetches get same-site treatment (no
 * browser-set Origin) and Chromium never sends chrome-extension:// referrers
 * to web origins — exactly the profile supermemory's working requests have.
 */
function buildHeaders(auth: XAuth): Record<string, string> {
  return {
    authorization: auth.auth,
    'content-type': 'application/json',
    'x-csrf-token': auth.csrf,
    Cookie: auth.cookie,
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
  };
}

// ---------------------------------------------------------------------------
// Response parsing (pure — exported for unit tests)
// ---------------------------------------------------------------------------

/** Loose shapes for the timeline JSON — only the fields we consume. */
interface RawTweetResult {
  rest_id?: string;
  core?: { user_results?: { result?: RawUserResult } };
  legacy?: RawTweetLegacy;
  // Some tweets wrap the real result under tweet.result (TweetWithVisibilityResults)
  tweet?: { rest_id?: string; core?: RawTweetResult['core']; legacy?: RawTweetLegacy };
}

interface RawUserResult {
  rest_id?: string;
  legacy?: { screen_name?: string; name?: string; profile_image_url_https?: string };
}

interface RawMedia {
  type?: string;
  media_url_https?: string;
  video_info?: { variants?: { url?: string; content_type?: string; bitrate?: number }[] };
}

interface RawTweetLegacy {
  full_text?: string;
  created_at?: string;
  favorite_count?: number;
  retweet_count?: number;
  reply_count?: number;
  lang?: string;
  entities?: { media?: RawMedia[] };
  extended_entities?: { media?: RawMedia[] };
}

interface RawEntry {
  entryId?: string;
  content?: {
    entryType?: string;
    cursorType?: string;
    value?: string;
    itemContent?: { tweet_results?: { result?: RawTweetResult } };
  };
}

interface RawInstruction {
  type?: string;
  entries?: RawEntry[];
}

/** Best video/gif variant URL (highest bitrate), else the photo url. */
function pickMedia(m: RawMedia): XMedia | null {
  if (m.type === 'photo' && m.media_url_https) {
    return { type: 'photo', url: m.media_url_https };
  }
  if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info?.variants?.length) {
    const best = [...m.video_info.variants]
      .filter((v) => v.content_type === 'video/mp4' && v.url)
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0];
    if (best?.url) return { type: m.type, url: best.url };
  }
  if (m.media_url_https) return { type: m.type ?? 'photo', url: m.media_url_https };
  return null;
}

/** Map one tweet_results.result → XRawBookmark. Null if unusable (ad/tombstone). */
export function mapTweetToRow(result: RawTweetResult | undefined | null): XRawBookmark | null {
  if (!result) return null;
  // Unwrap TweetWithVisibilityResults.
  const t = result.tweet ?? result;
  const restId = t.rest_id;
  const legacy = t.legacy;
  const user = t.core?.user_results?.result;
  if (!restId || !legacy || !user?.legacy?.screen_name) return null;

  const handle = user.legacy.screen_name;
  const mediaRaw = legacy.extended_entities?.media ?? legacy.entities?.media ?? [];
  const media = mediaRaw.map(pickMedia).filter((x): x is XMedia => x !== null);

  return {
    id: restId,
    text: legacy.full_text ?? '',
    createdAt: legacy.created_at ?? '',
    author: {
      handle,
      name: user.legacy.name ?? handle,
      avatarUrl: user.legacy.profile_image_url_https ?? '',
      restId: user.rest_id ?? '',
    },
    media,
    likeCount: legacy.favorite_count ?? 0,
    retweetCount: legacy.retweet_count ?? 0,
    replyCount: legacy.reply_count ?? 0,
    lang: legacy.lang ?? '',
    url: `https://x.com/${handle}/status/${restId}`,
  };
}

/** Extract all bookmarked tweets from timeline instructions. */
export function parseTweets(instructions: RawInstruction[]): XRawBookmark[] {
  const out: XRawBookmark[] = [];
  for (const inst of instructions ?? []) {
    for (const entry of inst.entries ?? []) {
      const result = entry.content?.itemContent?.tweet_results?.result;
      if (!result) continue;
      const row = mapTweetToRow(result);
      if (row) out.push(row);
    }
  }
  return out;
}

/** The Bottom cursor value (next page), or null when the list ended. */
export function extractBottomCursor(instructions: RawInstruction[]): string | null {
  for (const inst of instructions ?? []) {
    for (const entry of inst.entries ?? []) {
      if (entry.content?.cursorType === 'Bottom' && entry.content.value) {
        return entry.content.value;
      }
    }
  }
  return null;
}

/** Navigate to `data.bookmark_timeline_v2.timeline.instructions`. */
function extractInstructions(json: unknown): RawInstruction[] {
  const timeline = (json as {
    data?: {
      bookmark_timeline_v2?: { timeline?: { instructions?: RawInstruction[] } };
      bookmark_collection_timeline?: { timeline?: { instructions?: RawInstruction[] } };
    };
  })?.data;
  return (
    timeline?.bookmark_timeline_v2?.timeline?.instructions ??
    // Defensive: tolerate the bookmark-folder wrapper shape too.
    timeline?.bookmark_collection_timeline?.timeline?.instructions ??
    []
  );
}

// ---------------------------------------------------------------------------
// Pacing helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** First 300 chars of the response body, for diagnosable thrown errors. */
async function bodySnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** Milliseconds until the reset timestamp header, floored (clock-skew safe). */
function sleepUntilReset(resetHeader: string | null): number {
  const reset = resetHeader ? Number(resetHeader) * 1000 : NaN;
  if (!Number.isFinite(reset)) return MIN_SLEEP_ON_RESET_MS;
  return Math.max(reset - Date.now(), MIN_SLEEP_ON_RESET_MS);
}

/** A GraphQL error entry as it appears in a 200-with-errors body. */
interface GraphQLError {
  code?: number;
  message?: string;
}

/** The `errors[]` array of a 200-with-errors body, or [] when absent. */
function graphqlErrors(json: unknown): GraphQLError[] {
  const errs = (json as { errors?: GraphQLError[] })?.errors;
  return Array.isArray(errs) ? errs : [];
}

/**
 * True when the 200 body carries the timeline wrapper we parse. An
 * empty-instructions timeline is still true — a legit "zero bookmarks" result.
 */
function hasTimelineShape(json: unknown): boolean {
  const data = (json as {
    data?: {
      bookmark_timeline_v2?: unknown;
      bookmark_collection_timeline?: unknown;
    };
  })?.data;
  return (
    data?.bookmark_timeline_v2 !== undefined || data?.bookmark_collection_timeline !== undefined
  );
}

// ---------------------------------------------------------------------------
// Pagination — serial, paced, backoff (anti-detection strategy §2/§6)
// ---------------------------------------------------------------------------

/**
 * Fetch ALL bookmarks via serial cursor pagination. Stops when: entries empty,
 * OR the Bottom cursor stops changing, OR `opts.shouldStop(id)` returns true
 * (incremental stop-on-known-id). Throws XAuthError (401/403) / XRateLimitError
 * (after exhausted backoff). Nothing is written here (fetch-only layer).
 */
export async function fetchAllBookmarks(
  auth: XAuth,
  onProgress?: BookmarksProgressCallback,
  opts: FetchBookmarksOptions = {},
): Promise<XRawBookmark[]> {
  const headers = buildHeaders(auth);

  const all: XRawBookmark[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    page += 1;
    const url = buildBookmarksUrl({ count: PAGE_SIZE, cursor });
    const { json, res } = await fetchPageWithBackoff(url, headers, opts.control);

    const instructions = extractInstructions(json);
    const tweets = parseTweets(instructions);

    // Incremental stop: append until (and excluding) the first known id.
    let hitKnown = false;
    for (const tweet of tweets) {
      if (opts.shouldStop?.(tweet.id)) {
        hitKnown = true;
        break;
      }
      all.push(tweet);
    }

    onProgress?.(all.length, page);

    if (hitKnown || tweets.length === 0) break;

    const nextCursor = extractBottomCursor(instructions);
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;

    // Proactive quota watch: pause until reset when remaining is nearly gone.
    const remaining = Number(res.headers.get('x-rate-limit-remaining'));
    if (Number.isFinite(remaining) && remaining <= REMAINING_STOP_THRESHOLD) {
      await sleep(sleepUntilReset(res.headers.get('x-rate-limit-reset')));
    } else {
      // Jittered inter-page delay to mimic human scroll.
      await sleep(BASE_DELAY_MS + Math.random() * JITTER_MS);
    }
  }

  return all;
}

/**
 * Fetch one page. On 429 / code:88 → sleep to reset, retry the SAME page. On
 * transient 5xx → capped exponential backoff + jitter. 401/403 → XAuthError.
 * Exhausted rate-limit retries → XRateLimitError.
 *
 * A HTTP 200 is NOT trusted blindly: X returns server-side rejections as 200
 * bodies carrying a GraphQL `errors[]` array (any code ≠ 88), and a wrong
 * queryId/features set can yield a 200 whose body has no timeline at all.
 * Either case is thrown (never returned as an empty result) so the sync
 * surfaces the real reason instead of a silent "0 fetched, success" (the
 * 07-16 root cause). Exported for isolated fetch-mock tests.
 */
export async function fetchPageWithBackoff(
  url: string,
  headers: Record<string, string>,
  control?: CooperativeCheckpoint,
): Promise<{ json: unknown; res: Response }> {
  let attempt = 0;

  while (true) {
    await control?.checkpoint();
    // Mirror supermemory's fetch verbatim: NO `credentials` option. Do NOT use
    // `credentials:'omit'` — omit means "exclude credentials (cookies) from
    // this request", which makes Chromium drop the Cookie header entirely, so
    // X received a cookieless request and answered 401/403 (2026-07 root
    // cause). The explicit Cookie header is allowed here because extension
    // contexts with host permission may set forbidden headers.
    const res = await fetchWithDeadline(url, { method: 'GET', headers, redirect: 'follow' });

    if (res.status === 401) {
      throw new XAuthError('X session invalid or expired (401)', 'rejected');
    }
    if (res.status === 403) {
      // 403 = ct0/csrf mismatch or auth_token expired — do not retry blindly.
      throw new XAuthError('X CSRF/auth rejected (403) — re-login to x.com', 'rejected');
    }

    if (res.status === 429) {
      const resetHeader = res.headers.get('x-rate-limit-reset');
      if (attempt >= MAX_RETRIES) {
        throw new XRateLimitError(
          'X rate limit exceeded (429)',
          resetHeader ? new Date(Number(resetHeader) * 1000) : null,
        );
      }
      attempt += 1;
      await sleep(sleepUntilReset(resetHeader));
      continue;
    }

    if (res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`X API HTTP ${res.status}: ${await bodySnippet(res)}${DIAG_SUFFIX}`);
      }
      attempt += 1;
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.random() * JITTER_MS);
      continue;
    }

    // X's error bodies carry the actual diagnosis (e.g. "The following
    // features cannot be null: …", stale-queryId 404/422) — never discard them.
    if (!res.ok) throw new Error(`X API HTTP ${res.status}: ${await bodySnippet(res)}${DIAG_SUFFIX}`);

    // Read the body ONCE (Response body is single-use) so both the JSON parse
    // and the raw-snippet diagnostic below can see it.
    const rawBody = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new Error(`X API 200 with non-JSON body: ${rawBody.slice(0, 300)}${DIAG_SUFFIX}`);
    }

    const errors = graphqlErrors(json);

    // 200 with body-level rate limit (code:88) — treat like 429.
    if (errors.some((e) => e.code === 88)) {
      const resetHeader = res.headers.get('x-rate-limit-reset');
      if (attempt >= MAX_RETRIES) {
        throw new XRateLimitError(
          'X rate limit exceeded (code:88)',
          resetHeader ? new Date(Number(resetHeader) * 1000) : null,
        );
      }
      attempt += 1;
      await sleep(sleepUntilReset(resetHeader));
      continue;
    }

    // 200 carrying a GraphQL rejection (any code ≠ 88) — X returns server-side
    // errors as HTTP 200. Surface it instead of letting extractInstructions
    // silently yield [] → a lying "0 fetched" sync.
    if (errors.length > 0) {
      const detail = errors
        .map((e) => `code ${e.code ?? '?'}: ${e.message ?? '(no message)'}`)
        .join('; ');
      throw new Error(
        `X API 200 with GraphQL errors — ${detail}. Body: ${rawBody.slice(0, 300)}${DIAG_SUFFIX}`,
      );
    }

    // 200 with NEITHER errors NOR the timeline wrapper — an unexpected shape
    // (e.g. a stale queryId/features silently degraded). Throw, don't return [].
    // A 200 WITH the timeline but empty instructions is a legit "zero
    // bookmarks" result and passes this guard (hasTimelineShape is true).
    if (!hasTimelineShape(json)) {
      throw new Error(
        `unexpected X response shape (no bookmark_timeline_v2, no errors): ${rawBody.slice(0, 300)}${DIAG_SUFFIX}`,
      );
    }

    return { json, res };
  }
}
