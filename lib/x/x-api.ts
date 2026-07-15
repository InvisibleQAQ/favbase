/**
 * X (Twitter) "API" layer — reads the user's bookmarks from X's PRIVATE
 * GraphQL endpoint in their logged-in session. Mirrors the role of
 * lib/github/github-api.ts + lib/bilibili/bilibili-api.ts (URL builders,
 * response normalization, structured errors, NO DB imports, NO UI copy — the
 * i18n seam lives at the UI boundary).
 *
 * X has no free official API, so this reads the internal `BookmarkSearchTimeline`
 * GraphQL operation used by the web client. Anti-detection ("防风控") is a
 * first-class concern: serial cursor pagination with jittered pacing, proactive
 * rate-limit-remaining pausing, and 429 reset-respecting backoff.
 *
 * Auth mirrors bilibili: cookies read via `chrome.cookies.get` and a hand-built
 * `Cookie` header (Chrome lets extension pages with host_permissions set the
 * otherwise-forbidden `Cookie` header). Origin/Referer are set by a DNR rule
 * (see public/rules.json rule id:2 — Chrome strips fetch-set Origin/Referer from
 * an extension page context).
 *
 * Pure helpers (parseTweets / extractBottomCursor / mapTweetToRow /
 * buildBookmarksUrl / parseQueryIdFromBundle) are exported for unit tests.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const X_COOKIE_URL = 'https://x.com';
const GRAPHQL_BASE = 'https://x.com/i/api/graphql';

/** X's shared PUBLIC web-client bearer (same for all logged-in web requests —
 *  NOT an OAuth token). Verbatim from the PRD Technical Notes. */
const PUBLIC_WEB_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

/** The current operation name (renamed ~2026-02 from `Bookmarks`). */
const BOOKMARKS_OPERATION = 'BookmarkSearchTimeline';

/** Last-resort fallback queryId (VOLATILE — X rotates these per client release;
 *  resolveBookmarksQueryId() attempts a runtime lookup first, see D7). */
const FALLBACK_QUERY_ID = 'fHKoSa-2dbV1UbhUy3EvcA';

// --- Anti-detection pacing constants (research/anti-detection-strategy.md §2) ---
/** Matches the real web client exactly = lowest fingerprint risk. */
const PAGE_SIZE = 20;
/** Per-page base delay before the next request. */
const BASE_DELAY_MS = 500;
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

/**
 * GraphQL `features` — ONLY `true`-valued keys (X treats missing keys as false).
 * Keeping this minimal avoids the 414 URI-Too-Long trap (the GET query string
 * bloats fast). `graphql_timeline_v2_bookmark_timeline` is the bookmark-specific
 * toggle; the rest are the responsive_web set the endpoint requires.
 */
const BOOKMARK_FEATURES: Record<string, boolean> = {
  graphql_timeline_v2_bookmark_timeline: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  tweetypie_unmention_optimization_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: true,
  creator_subscriptions_quote_tweet_preview_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false, // deliberately false → omitted
};

// ---------------------------------------------------------------------------
// Errors — structured, no UI copy (i18n seam is at the UI boundary)
// ---------------------------------------------------------------------------

export class XAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XAuthError';
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

export interface XAuth {
  /** ct0 cookie — doubles as the x-csrf-token (X double-submit CSRF check). */
  ct0: string;
  /** auth_token cookie — the login session. */
  authToken: string;
}

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
}

// ---------------------------------------------------------------------------
// Auth — requires chrome.cookies (Extension Page / Background SW)
// ---------------------------------------------------------------------------

/** Read ct0 + auth_token from x.com cookies. Null if either missing/expired. */
export async function getXAuth(): Promise<XAuth | null> {
  const [ct0Cookie, authCookie] = await Promise.all([
    chrome.cookies.get({ url: X_COOKIE_URL, name: 'ct0' }),
    chrome.cookies.get({ url: X_COOKIE_URL, name: 'auth_token' }),
  ]);

  if (!ct0Cookie?.value || !authCookie?.value) return null;

  const now = Date.now() / 1000;
  if (ct0Cookie.expirationDate && ct0Cookie.expirationDate < now) return null;
  if (authCookie.expirationDate && authCookie.expirationDate < now) return null;

  return { ct0: ct0Cookie.value, authToken: authCookie.value };
}

// ---------------------------------------------------------------------------
// queryId resolution (runtime, D7) — mirrors bird's update-query-ids.ts
// ---------------------------------------------------------------------------

/**
 * Parse `{ operationName ↔ queryId }` pairs out of an X client-web JS bundle.
 * The bundle contains fragments like `queryId:"abc123",operationName:"BookmarkSearchTimeline"`
 * (order varies), so we match both orderings. Pure — exported for unit tests.
 */
export function parseQueryIdFromBundle(bundle: string, operation: string): string | null {
  // operationName then queryId
  const re1 = new RegExp(
    `operationName:"${operation}"[^}]*?queryId:"([\\w-]+)"`,
  );
  // queryId then operationName
  const re2 = new RegExp(
    `queryId:"([\\w-]+)"[^}]*?operationName:"${operation}"`,
  );
  return bundle.match(re1)?.[1] ?? bundle.match(re2)?.[1] ?? null;
}

/**
 * Best-effort runtime resolution of the BookmarkSearchTimeline queryId.
 * Fetches the x.com home HTML, finds a client-web JS bundle, and greps the
 * operation↔queryId pair. ANY failure degrades gracefully to the hardcoded
 * fallback (D7 — never rely solely on the hardcode; also never crash sync).
 */
export async function resolveBookmarksQueryId(): Promise<string> {
  try {
    const homeRes = await fetch('https://x.com/', { credentials: 'include' });
    if (!homeRes.ok) return FALLBACK_QUERY_ID;
    const html = await homeRes.text();

    // Client-web bundles are referenced on abs.twimg.com. Collect candidates
    // that plausibly carry GraphQL operation maps (main/api bundles).
    const bundleUrls = [
      ...new Set(
        html.match(/https:\/\/abs\.twimg\.com\/responsive-web\/[^"']+\.js/g) ?? [],
      ),
    ].filter((u) => /(main|api|bundle)/.test(u));

    for (const url of bundleUrls.slice(0, 8)) {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) continue;
      const code = await res.text();
      const id = parseQueryIdFromBundle(code, BOOKMARKS_OPERATION);
      if (id) return id;
    }
  } catch (err) {
    console.warn('[x-api] queryId runtime resolution failed, using fallback:', err);
  }
  return FALLBACK_QUERY_ID;
}

// ---------------------------------------------------------------------------
// URL / header builders (pure where possible)
// ---------------------------------------------------------------------------

/** Only the `true`-valued feature keys (414 trap mitigation). */
function trueFeatures(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(BOOKMARK_FEATURES)) if (v) out[k] = true;
  return out;
}

/**
 * Build the BookmarkSearchTimeline GET URL. `variables` is isomorphic to
 * SearchTimeline: empty rawQuery = all bookmarks newest-first; first page omits
 * cursor. `features` carries only true keys. Pure — exported for unit tests.
 */
export function buildBookmarksUrl(
  queryId: string,
  opts: { count?: number; cursor?: string } = {},
): string {
  const variables: Record<string, unknown> = {
    count: opts.count ?? PAGE_SIZE,
    querySource: '',
    rawQuery: '',
  };
  if (opts.cursor) variables.cursor = opts.cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(trueFeatures()),
  });
  return `${GRAPHQL_BASE}/${queryId}/${BOOKMARKS_OPERATION}?${params.toString()}`;
}

function buildHeaders(auth: XAuth): Record<string, string> {
  return {
    authorization: `Bearer ${PUBLIC_WEB_BEARER}`,
    'content-type': 'application/json',
    'x-csrf-token': auth.ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    // Chrome lets extension pages (with host permission) set the otherwise
    // forbidden Cookie header; Origin/Referer are set by the DNR rule.
    Cookie: `auth_token=${auth.authToken}; ct0=${auth.ct0}`,
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

/** Navigate to `data.search_by_raw_query.bookmarks_search_timeline.timeline.instructions`. */
function extractInstructions(json: unknown): RawInstruction[] {
  const timeline = (json as {
    data?: {
      bookmark_timeline_v2?: { timeline?: { instructions?: RawInstruction[] } };
      search_by_raw_query?: {
        bookmarks_search_timeline?: { timeline?: { instructions?: RawInstruction[] } };
      };
    };
  })?.data;
  return (
    timeline?.search_by_raw_query?.bookmarks_search_timeline?.timeline?.instructions ??
    // Defensive: tolerate the old Bookmarks wrapper shape too.
    timeline?.bookmark_timeline_v2?.timeline?.instructions ??
    []
  );
}

// ---------------------------------------------------------------------------
// Pacing helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Milliseconds until the reset timestamp header, floored (clock-skew safe). */
function sleepUntilReset(resetHeader: string | null): number {
  const reset = resetHeader ? Number(resetHeader) * 1000 : NaN;
  if (!Number.isFinite(reset)) return MIN_SLEEP_ON_RESET_MS;
  return Math.max(reset - Date.now(), MIN_SLEEP_ON_RESET_MS);
}

/** GraphQL 200-with-error: errors[].code === 88 = rate limited (code:88). */
function isRateLimitBody(json: unknown): boolean {
  const errs = (json as { errors?: { code?: number }[] })?.errors;
  return Array.isArray(errs) && errs.some((e) => e.code === 88);
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
  const queryId = await resolveBookmarksQueryId();
  const headers = buildHeaders(auth);

  const all: XRawBookmark[] = [];
  let cursor: string | undefined;
  let page = 0;

  while (true) {
    page += 1;
    const url = buildBookmarksUrl(queryId, { count: PAGE_SIZE, cursor });
    const { json, res } = await fetchPageWithBackoff(url, headers);

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
 */
async function fetchPageWithBackoff(
  url: string,
  headers: Record<string, string>,
): Promise<{ json: unknown; res: Response }> {
  let attempt = 0;

  while (true) {
    const res = await fetch(url, { headers, credentials: 'include' });

    if (res.status === 401) {
      throw new XAuthError('X session invalid or expired (401)');
    }
    if (res.status === 403) {
      // 403 = ct0/csrf mismatch or auth_token expired — do not retry blindly.
      throw new XAuthError('X CSRF/auth rejected (403) — re-login to x.com');
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
      if (attempt >= MAX_RETRIES) throw new Error(`X API HTTP ${res.status}`);
      attempt += 1;
      await sleep(BACKOFF_BASE_MS * 2 ** (attempt - 1) + Math.random() * JITTER_MS);
      continue;
    }

    if (!res.ok) throw new Error(`X API HTTP ${res.status}`);

    const json = await res.json();

    // 200 with body-level rate limit (code:88) — treat like 429.
    if (isRateLimitBody(json)) {
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

    return { json, res };
  }
}
