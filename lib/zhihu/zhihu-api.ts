/**
 * Zhihu favorites "API" layer — reads the logged-in user's PUBLIC collections
 * (收藏夹) and their items from Zhihu's web APIs. Mirrors the role of
 * lib/x/x-api.ts + lib/bilibili/bilibili-api.ts (URL builders, response
 * normalization, structured errors, NO DB imports, NO UI copy — the i18n seam
 * lives at the UI boundary).
 *
 * Auth is bilibili-style: the fetch runs in an extension context with
 * `*.zhihu.com` host permissions and `credentials:'include'`, so the browser
 * attaches the user's real zhihu session cookies (z_c0 / d_c0 / __zse_ck)
 * automatically. No webRequest capture, no chrome.cookies, no x-zse-96
 * signature — the collection endpoints don't validate it (RSSHub-verified,
 * see task research/zhihu-api.md). The only special header is
 * `x-api-version: 3.0.91` on the v4 items endpoint (mirrors RSSHub).
 * Referer cannot be set from fetch (forbidden header) and is NOT rewritten via
 * DNR — extension-context requests arrive referrer-less, which zhihu accepted
 * in the X precedent's fingerprint analysis. [UNKNOWN until live-tested]
 *
 * Anti-rate-limit (403 is zhihu's main rejection form): strictly SERIAL
 * pagination with a jittered inter-page delay (mirrors lib/x/x-api.ts —
 * RSSHub's Promise.all fan-out is deliberately NOT copied). Zhihu sends no
 * rate-limit headers, so 429/5xx get capped exponential backoff and 403 is
 * surfaced immediately as ZhihuRateLimitError (retrying an anti-crawler block
 * only digs the hole deeper).
 *
 * HTTP 200 is NEVER trusted blindly (spec error matrix, X 07-16 root cause):
 * a 200 carrying an `error` body, a non-JSON (challenge HTML) body, or a body
 * without the expected `data` array is thrown, not returned as [].
 *
 * Pure helpers (mapCollection / mapCollectionItem / buildCollectionItemsUrl /
 * stripHtmlToText) are exported for unit tests.
 */

import type { CooperativeCheckpoint } from '@/lib/collections';
import { envNumber } from '@/lib/env';
import { backoffDelayMs, jitteredDelayMs, sleep } from '@/lib/http/backoff';
import { fetchWithDeadline } from '@/lib/http/fetch-with-deadline';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WWW_BASE = 'https://www.zhihu.com';
const APP_API_BASE = 'https://api.zhihu.com';
const ME_URL = `${WWW_BASE}/api/v4/me`;

/** v4 items endpoint requires this (RSSHub sends it on every items request). */
const ITEMS_API_VERSION = '3.0.91';
/** Items per page — 20 is the documented server-side cap for this endpoint. */
const ITEMS_PAGE_SIZE = envNumber('VITE_ZHIHU_ITEMS_PAGE_SIZE', 20);

// --- Anti-rate-limit pacing constants (mirrors lib/x/x-api.ts) ---
/** Per-page base delay before the next request. */
const BASE_DELAY_MS = envNumber('VITE_ZHIHU_BASE_DELAY_MS', 1000);
/** Added as `Math.random() * JITTER_MS` to simulate human scroll cadence. */
const JITTER_MS = envNumber('VITE_ZHIHU_JITTER_MS', 500);
/** Cap retries for transient 429/5xx — never loop forever. */
const MAX_RETRIES = envNumber('VITE_ZHIHU_MAX_RETRIES', 5);
/** Base for `base * 2^n + jitter` transient backoff. */
const BACKOFF_BASE_MS = envNumber('VITE_ZHIHU_BACKOFF_BASE_MS', 1000);
/** Runaway guards — a healthy account never comes close to these. */
const MAX_COLLECTION_PAGES = envNumber('VITE_ZHIHU_MAX_COLLECTION_PAGES', 50);
const MAX_ITEM_PAGES_PER_COLLECTION = envNumber('VITE_ZHIHU_MAX_ITEM_PAGES_PER_COLLECTION', 500);

// ---------------------------------------------------------------------------
// Errors — structured, no UI copy (i18n seam is at the UI boundary)
// ---------------------------------------------------------------------------

/** Not logged in to zhihu.com (401 from any endpoint, incl. /api/v4/me). */
export class ZhihuAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZhihuAuthError';
  }
}

/**
 * Zhihu rejected the request as rate-limited / anti-crawler (403, or 429 after
 * exhausted backoff). Zhihu exposes no reset header, so there is no resetAt.
 */
export class ZhihuRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZhihuRateLimitError';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four content types a zhihu collection can contain. */
export type ZhihuItemType = 'answer' | 'article' | 'pin' | 'zvideo';

/** A public collection (收藏夹) of the logged-in user. */
export interface ZhihuCollection {
  id: string;
  title: string;
}

/**
 * Normalized favorite entry — the fetch layer's output contract (no DB shape).
 * An item favorited into two collections yields TWO entries (one per
 * collection); the sync service dedupes items and links each membership.
 */
export interface ZhihuRawFavorite {
  type: ZhihuItemType;
  /** Content id within its type namespace (answer id / article id / …). */
  id: string;
  title: string;
  /** Web (user-clickable) URL, constructed deterministically from type+id. */
  url: string;
  /** Full HTML body (answer/article), assembled segments (pin), null (zvideo). */
  contentHtml: string | null;
  /** Plain-text summary for card display. */
  excerpt: string;
  author: { id: string; name: string; avatarUrl: string };
  /** Content created/updated time in EPOCH SECONDS; null if absent. */
  createdAt: number | null;
  /** Cover / first image, if any. */
  thumbnailUrl: string | null;
  collectionId: string;
  collectionTitle: string;
}

/** Progress callback fired per fetched items page (cumulative across collections). */
export type ZhihuProgressCallback = (
  fetchedCount: number,
  collectionIndex: number,
  collectionCount: number,
) => void;

export interface ZhihuFetchAllResult {
  collections: ZhihuCollection[];
  favorites: ZhihuRawFavorite[];
}

// ---------------------------------------------------------------------------
// Raw response shapes — only the fields we consume (loose, defensive)
// ---------------------------------------------------------------------------

interface RawZhihuAuthor {
  id?: unknown;
  url_token?: unknown;
  name?: unknown;
  avatar_url?: unknown;
}

interface RawPinSegment {
  type?: unknown;
  /** text segment: HTML fragment */
  content?: unknown;
  /** image segment: image URL; link segment: target URL */
  url?: unknown;
  /** link segment title */
  title?: unknown;
  cover_info?: { thumbnail?: unknown };
}

interface RawCollectionItemContent {
  type?: unknown;
  id?: unknown;
  /** article / zvideo */
  title?: unknown;
  /** answer */
  question?: { id?: unknown; title?: unknown };
  url?: unknown;
  /** answer/article: HTML string; pin: segment array */
  content?: unknown;
  excerpt?: unknown;
  /** pin */
  excerpt_title?: unknown;
  author?: RawZhihuAuthor;
  /** zvideo cover image URL */
  video?: { url?: unknown };
  /** article cover */
  image_url?: unknown;
  /** pin (seconds) */
  created?: unknown;
  /** article (seconds) */
  updated?: unknown;
  /** answer / zvideo (seconds) */
  updated_time?: unknown;
}

interface RawCollectionItem {
  content?: RawCollectionItemContent;
}

interface RawCollection {
  id?: unknown;
  title?: unknown;
  is_public?: unknown;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** v4 items URL for one collection page. */
export function buildCollectionItemsUrl(collectionId: string, offset: number): string {
  return `${WWW_BASE}/api/v4/collections/${encodeURIComponent(collectionId)}/items?offset=${offset}&limit=${ITEMS_PAGE_SIZE}`;
}

/** Minimal HTML → plain text (tags stripped, common entities decoded). */
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip zhihu image size suffix: `..._720w.jpg → ....jpg`. Shared with
 *  zhihu-markdown.ts (same CDN URL scheme in pin segments and rich-text imgs). */
export function stripImageSizeSuffix(url: string): string {
  return url.replace(/_[a-z0-9]+(\.(?:jpg|jpeg|png|gif|webp))/i, '$1');
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function asEpochSeconds(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Map one raw collection row → ZhihuCollection, or null when unusable OR not
 * public. `is_public` field shape is unverified in the wild — only an explicit
 * `false` / `0` marks a collection private (defensive default: public).
 */
export function mapCollection(raw: unknown): ZhihuCollection | null {
  const c = (raw ?? {}) as RawCollection;
  const id = c.id !== undefined && c.id !== null ? String(c.id) : '';
  if (!id) return null;
  if (c.is_public === false || c.is_public === 0) return null;
  return { id, title: asString(c.title) || id };
}

function mapAuthor(raw: RawZhihuAuthor | undefined): ZhihuRawFavorite['author'] {
  const id = asString(raw?.id) || asString(raw?.url_token) || 'anonymous';
  return {
    id,
    name: asString(raw?.name) || 'anonymous',
    avatarUrl: asString(raw?.avatar_url),
  };
}

/** Assemble a pin's segment array into a single HTML fragment. */
function assemblePinHtml(segments: RawPinSegment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    const type = asString(seg.type);
    if (type === 'text' && asString(seg.content)) {
      parts.push(asString(seg.content));
    } else if (type === 'image' && asString(seg.url)) {
      parts.push(`<img src="${stripImageSizeSuffix(asString(seg.url))}">`);
    } else if (type === 'video') {
      const thumb = asString(seg.cover_info?.thumbnail);
      if (thumb) parts.push(`<img src="${thumb}">`);
    } else if ((type === 'link' || type === 'link_card') && asString(seg.url)) {
      const url = asString(seg.url);
      const title = asString(seg.title) || url;
      parts.push(`<p><a href="${url}">${title}</a></p>`);
    }
  }
  return parts.join('\n');
}

/** First image of a pin's segments (card thumbnail). */
function firstPinImage(segments: RawPinSegment[]): string | null {
  for (const seg of segments) {
    if (asString(seg.type) === 'image' && asString(seg.url)) {
      return stripImageSizeSuffix(asString(seg.url));
    }
    if (asString(seg.type) === 'video' && asString(seg.cover_info?.thumbnail)) {
      return asString(seg.cover_info?.thumbnail);
    }
  }
  return null;
}

/**
 * Normalize one v4 items entry → ZhihuRawFavorite. Null when the entry is
 * unusable (no content / no id / unknown type — zhihu may add types anytime).
 * Mapping table: task research/zhihu-api.md §3.2 (RSSHub collection.ts:101-117).
 */
export function mapCollectionItem(
  raw: unknown,
  collection: ZhihuCollection,
): ZhihuRawFavorite | null {
  const content = (raw as RawCollectionItem | null | undefined)?.content;
  if (!content) return null;

  const type = asString(content.type);
  if (type !== 'answer' && type !== 'article' && type !== 'pin' && type !== 'zvideo') return null;

  const id = content.id !== undefined && content.id !== null ? String(content.id) : '';
  if (!id) return null;

  const author = mapAuthor(content.author);
  const rawUrl = asString(content.url);
  const base = { author, collectionId: collection.id, collectionTitle: collection.title };

  switch (type) {
    case 'answer': {
      const html = asString(content.content);
      const excerpt = asString(content.excerpt) || stripHtmlToText(html).slice(0, 200);
      const questionId =
        content.question?.id !== undefined && content.question?.id !== null
          ? String(content.question.id)
          : '';
      return {
        ...base,
        type,
        id,
        title: asString(content.question?.title) || excerpt.slice(0, 80) || `answer ${id}`,
        url: questionId
          ? `${WWW_BASE}/question/${questionId}/answer/${id}`
          : rawUrl || `${WWW_BASE}/answer/${id}`,
        contentHtml: html || null,
        excerpt,
        createdAt: asEpochSeconds(content.updated_time),
        thumbnailUrl: null,
      };
    }
    case 'article': {
      const html = asString(content.content);
      const excerpt = asString(content.excerpt) || stripHtmlToText(html).slice(0, 200);
      return {
        ...base,
        type,
        id,
        title: asString(content.title) || excerpt.slice(0, 80) || `article ${id}`,
        url: `https://zhuanlan.zhihu.com/p/${id}`,
        contentHtml: html || null,
        excerpt,
        createdAt: asEpochSeconds(content.updated),
        thumbnailUrl: asString(content.image_url) || null,
      };
    }
    case 'pin': {
      const segments = Array.isArray(content.content) ? (content.content as RawPinSegment[]) : [];
      const html = assemblePinHtml(segments);
      const text = stripHtmlToText(html);
      return {
        ...base,
        type,
        id,
        title: asString(content.excerpt_title) || text.slice(0, 80) || `pin ${id}`,
        url: `${WWW_BASE}/pin/${id}`,
        contentHtml: html || null,
        excerpt: asString(content.excerpt) || text.slice(0, 200),
        createdAt: asEpochSeconds(content.created),
        thumbnailUrl: firstPinImage(segments),
      };
    }
    case 'zvideo': {
      // Video favorites carry no transcript/body — title + cover only.
      return {
        ...base,
        type,
        id,
        title: asString(content.title) || `zvideo ${id}`,
        url: rawUrl && rawUrl.startsWith('http') ? rawUrl : `${WWW_BASE}/zvideo/${id}`,
        contentHtml: null,
        excerpt: asString(content.excerpt),
        createdAt: asEpochSeconds(content.updated_time),
        thumbnailUrl: asString(content.video?.url) || null,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch core — serial, paced, backoff; HTTP 200 never trusted
// ---------------------------------------------------------------------------

function jitteredDelay(): Promise<void> {
  return sleep(jitteredDelayMs(BASE_DELAY_MS, JITTER_MS));
}

/** Zhihu v4 error body: `{ error: { message, code, name } }`. */
function zhihuApiError(json: unknown): { code?: number; message?: string } | null {
  const err = (json as { error?: { code?: number; message?: string } } | null)?.error;
  if (err && (err.message !== undefined || err.code !== undefined)) return err;
  return null;
}

/**
 * Fetch one zhihu API URL with the session cookies attached by the browser
 * (`credentials:'include'` + host permission). 401 → ZhihuAuthError; 403 →
 * ZhihuRateLimitError (anti-crawler — NOT retried); 429/5xx → capped backoff.
 * A 200 with a non-JSON body (challenge HTML) or an `error` body is thrown
 * with a diagnosable snippet — never swallowed into an empty result.
 */
async function fetchZhihuJson(
  url: string,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  let attempt = 0;

  while (true) {
    const res = await fetchWithDeadline(url, {
      method: 'GET',
      credentials: 'include',
      headers: extraHeaders,
      redirect: 'follow',
    });

    if (res.status === 401) {
      throw new ZhihuAuthError('Zhihu session invalid or not logged in (401)');
    }
    if (res.status === 403) {
      // Zhihu's anti-crawler rejection — retrying immediately makes it worse.
      throw new ZhihuRateLimitError(`Zhihu rejected the request (403): ${await bodySnippet(res)}`);
    }
    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new ZhihuRateLimitError('Zhihu rate limit exceeded (429)');
      }
      attempt += 1;
      await sleep(backoffDelayMs(attempt, BACKOFF_BASE_MS, JITTER_MS));
      continue;
    }
    if (res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`Zhihu API HTTP ${res.status}: ${await bodySnippet(res)}`);
      }
      attempt += 1;
      await sleep(backoffDelayMs(attempt, BACKOFF_BASE_MS, JITTER_MS));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Zhihu API HTTP ${res.status}: ${await bodySnippet(res)}`);
    }

    // Read the body ONCE so both the parse and the diagnostics can see it.
    const rawBody = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      // A 200 challenge/HTML page (e.g. __zse_ck verification) — surface it.
      throw new Error(`Zhihu API 200 with non-JSON body: ${rawBody.slice(0, 300)}`);
    }

    // 200 carrying an error body — zhihu returns some rejections this way.
    const apiErr = zhihuApiError(json);
    if (apiErr) {
      const detail = `code ${apiErr.code ?? '?'}: ${apiErr.message ?? '(no message)'}`;
      // code 100/101 family = unauthenticated/invalid token.
      if (apiErr.code === 100 || apiErr.code === 101) {
        throw new ZhihuAuthError(`Zhihu API auth error — ${detail}`);
      }
      throw new Error(`Zhihu API 200 with error body — ${detail}. Body: ${rawBody.slice(0, 300)}`);
    }

    return json;
  }
}

/** First 300 chars of the response body, for diagnosable thrown errors. */
async function bodySnippet(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Endpoint calls
// ---------------------------------------------------------------------------

/**
 * Resolve the logged-in user's url_token via /api/v4/me. Throws ZhihuAuthError
 * on 401 (not logged in). A 200 without url_token is a contract break
 * ([UNKNOWN] — RSSHub only reads `name`; url_token presence needs live data).
 */
export async function fetchSelfUrlToken(): Promise<string> {
  const json = await fetchZhihuJson(ME_URL);
  const me = json as { url_token?: unknown };
  const token = asString(me?.url_token);
  if (token) return token;
  throw new Error(
    `Zhihu /api/v4/me response lacks url_token: ${JSON.stringify(json).slice(0, 300)}`,
  );
}

/**
 * List the user's PUBLIC collections. RSSHub reads this endpoint unpaginated;
 * defensively follow `paging.next` when the response says it isn't the end.
 */
export async function fetchCollections(
  urlToken: string,
  control?: CooperativeCheckpoint,
): Promise<ZhihuCollection[]> {
  const out: ZhihuCollection[] = [];
  const seen = new Set<string>();
  let url: string | null = `${APP_API_BASE}/people/${encodeURIComponent(urlToken)}/collections`;
  let pages = 0;

  while (url && pages < MAX_COLLECTION_PAGES) {
    await control?.checkpoint();
    pages += 1;
    const json = await fetchZhihuJson(url);
    const body = json as { data?: unknown; paging?: { is_end?: unknown; next?: unknown } };
    if (!Array.isArray(body?.data)) {
      throw new Error(
        `unexpected Zhihu collections shape (no data array): ${JSON.stringify(json).slice(0, 300)}`,
      );
    }
    for (const raw of body.data) {
      const collection = mapCollection(raw);
      if (collection && !seen.has(collection.id)) {
        seen.add(collection.id);
        out.push(collection);
      }
    }

    const paging = body.paging;
    const next =
      paging && paging.is_end === false && typeof paging.next === 'string' ? paging.next : null;
    if (!next || next === url || body.data.length === 0) break;
    url = next;
    await jitteredDelay();
  }

  return out;
}

/**
 * Fetch ALL items of one collection via serial offset/limit pagination.
 * Stops on `paging.is_end`, an empty page, or the `paging.totals` boundary.
 */
export async function fetchCollectionItems(
  collection: ZhihuCollection,
  onPage?: (fetchedInCollection: number) => void,
  control?: CooperativeCheckpoint,
): Promise<ZhihuRawFavorite[]> {
  const out: ZhihuRawFavorite[] = [];
  let offset = 0;
  let pages = 0;

  while (pages < MAX_ITEM_PAGES_PER_COLLECTION) {
    await control?.checkpoint();
    pages += 1;
    const json = await fetchZhihuJson(buildCollectionItemsUrl(collection.id, offset), {
      'x-api-version': ITEMS_API_VERSION,
    });
    const body = json as { data?: unknown; paging?: { is_end?: unknown; totals?: unknown } };
    if (!Array.isArray(body?.data)) {
      throw new Error(
        `unexpected Zhihu items shape for collection ${collection.id} (no data array): ${JSON.stringify(json).slice(0, 300)}`,
      );
    }

    for (const raw of body.data) {
      const favorite = mapCollectionItem(raw, collection);
      if (favorite) out.push(favorite);
    }
    onPage?.(out.length);

    if (body.data.length === 0 || body.paging?.is_end === true) break;
    offset += ITEMS_PAGE_SIZE;
    const totals = Number(body.paging?.totals);
    if (Number.isFinite(totals) && offset >= totals) break;

    await jitteredDelay();
  }

  return out;
}

/**
 * One-shot full fetch: me → public collections → every collection's items,
 * strictly serial with jittered pauses between every request. Progress fires
 * per items page with the cumulative favorite count + collection cursor.
 * Nothing is written here (fetch-only layer).
 */
export async function fetchAllFavorites(
  onProgress?: ZhihuProgressCallback,
  control?: CooperativeCheckpoint,
): Promise<ZhihuFetchAllResult> {
  const urlToken = await fetchSelfUrlToken();
  await control?.checkpoint();
  await jitteredDelay();

  const collections = await fetchCollections(urlToken, control);
  const favorites: ZhihuRawFavorite[] = [];

  for (let i = 0; i < collections.length; i++) {
    await control?.checkpoint();
    const collection = collections[i];
    onProgress?.(favorites.length, i + 1, collections.length);
    await jitteredDelay();

    const base = favorites.length;
    const items = await fetchCollectionItems(
      collection,
      (count) => onProgress?.(base + count, i + 1, collections.length),
      control,
    );
    favorites.push(...items);
  }

  return { collections, favorites };
}
