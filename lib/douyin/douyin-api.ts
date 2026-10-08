/**
 * Douyin (抖音) favorites "API" layer — request construction, response
 * classification, pacing and the three paged walks. No DB imports, no UI
 * copy, no chrome.*, no storage, no direct network: every request goes
 * through an injected `DouyinTransport` (docs/33 §4.1).
 *
 * Why a transport and not `fetchWithDeadline`: since 2026-08-16/17 all three
 * favorites endpoints sit in the page SDK's `webSign` protected list, and an
 * unsigned request is a `403 Blocked by ArgusSecurityPlugin`. The app (docs/33
 * Step 2) runs each request inside the user's own www.douyin.com tab, where
 * the page SDK adds `a_bogus` / `x-secsdk-web-signature` itself (docs/33 D4).
 * So this file builds requests with business parameters only — a signature
 * parameter filled in here would void the signature the SDK computes.
 *
 * Vocabulary trap: in Douyin's API `collect*` is 收藏 (this platform) and
 * `favorite*` is 喜欢 / likes (not this platform, never called here).
 *
 * Failures are classified by SHAPE, not by a status-code table (docs/33
 * §4.4); `lib/douyin/CLAUDE.md` has the shape → action table. The retry loop,
 * waits and body snippets are shared mechanism from lib/http/; the numbers
 * are this file's, every one of them through `envNumber`.
 */

import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import {
  PlatformAuthError,
  PlatformRateLimitError,
  type AuthFailReason,
} from '@/lib/collections/sync-errors';
import { envNumber } from '@/lib/env';
import { backoffDelayMs, jitteredDelayMs, sleep } from '@/lib/http/backoff';
import { resolveHttpDeadlineMs } from '@/lib/http/fetch-with-deadline';
import { textSnippet } from '@/lib/http/response-body';
import { retryAfter, withRetries, type RetrySignal } from '@/lib/http/retry';

// ---------------------------------------------------------------------------
// Constants (docs/33 §4.5 — defaults documented in .env.example)
// ---------------------------------------------------------------------------

/** Items per page on all three endpoints. `count ≥ 40` is `status_code: 5` (live probe), so stay well under. */
const PAGE_SIZE = envNumber('VITE_DOUYIN_PAGE_SIZE', 20);
/** Every request but a run's first waits `MIN + random·JITTER` (one chain for all three endpoints). */
const PAGE_DELAY_MIN_MS = envNumber('VITE_DOUYIN_PAGE_DELAY_MIN_MS', 5_000);
const PAGE_DELAY_JITTER_MS = envNumber('VITE_DOUYIN_PAGE_DELAY_JITTER_MS', 3_000);
/** After every N requests (retries count — risk control counts requests), one long rest. 0 disables it. */
const REST_EVERY_PAGES = envNumber('VITE_DOUYIN_REST_EVERY_PAGES', 25);
const REST_MIN_MS = envNumber('VITE_DOUYIN_REST_MIN_MS', 60_000);
const REST_JITTER_MS = envNumber('VITE_DOUYIN_REST_JITTER_MS', 120_000);
/** Runaway fuse: pages per walk segment (≈ 4000 favorites at 20 per page; the 2026-10-03 "2299" baseline was a misread, see docs/33 Step 3). */
const MAX_PAGES = envNumber('VITE_DOUYIN_MAX_PAGES', 200);
/** One budget shared by 5xx, unreachable and empty-200 retries (docs/33 D-d). 403 / 429 never retry. */
const MAX_RETRIES = envNumber('VITE_DOUYIN_MAX_RETRIES', 2);
const BACKOFF_BASE_MS = envNumber('VITE_DOUYIN_BACKOFF_BASE_MS', 2_000);
const BACKOFF_JITTER_MS = envNumber('VITE_DOUYIN_BACKOFF_JITTER_MS', 500);
/** How long a rate-limit / soft stop locks the Fetch button (`DouyinRateLimitError.resetAt`). */
const COOLDOWN_MS = envNumber('VITE_DOUYIN_COOLDOWN_MS', 1_800_000);

/** The three non-signature parameters every www.douyin.com web API call carries. */
const COMMON_QUERY: Readonly<Record<string, string>> = {
  device_platform: 'webapp',
  aid: '6383',
  channel: 'channel_pc_web',
};

const COLLECTION_PATH = '/aweme/v1/web/aweme/listcollection/';
const FOLDERS_PATH = '/aweme/v1/web/collects/list/';
const FOLDER_ITEMS_PATH = '/aweme/v1/web/collects/video/list/';
/** One aweme in full — the transcription handler's source of media URLs (docs/37 §4.2). */
const DETAIL_PATH = '/aweme/v1/web/aweme/detail/';

const WHAT_COLLECTION = 'Douyin listcollection';
const WHAT_FOLDERS = 'Douyin collects/list';
const WHAT_FOLDER_ITEMS = 'Douyin collects/video/list';
export const WHAT_DETAIL = 'Douyin aweme/detail';

// ---------------------------------------------------------------------------
// Transport contract (lib defines it, the app implements it — docs/33 §4.1)
// ---------------------------------------------------------------------------

export interface DouyinRequest {
  method: 'GET' | 'POST';
  /** Relative to https://www.douyin.com, e.g. `/aweme/v1/web/collects/list/`. */
  path: string;
  /** Business parameters + the three common ones. Never a signature parameter. */
  query: Record<string, string>;
  /** POST only: sent as `application/x-www-form-urlencoded`. */
  form?: Record<string, string>;
  /** The unified HTTP deadline (`resolveHttpDeadlineMs`), enforced by the transport. */
  timeoutMs: number;
}

export type DouyinTransportResult =
  | { kind: 'response'; status: number; text: string }
  /** The page's `fetch` is still native — the SDK has not wrapped it yet, so nothing would be signed. */
  | { kind: 'sdk-not-ready' }
  /** Network error, timeout, tab closed or navigated away, injection failed. */
  | { kind: 'unreachable'; message: string };

/** Runs one request in the douyin.com page. Never throws: every failure is a `kind`. */
export type DouyinTransport = (req: DouyinRequest) => Promise<DouyinTransportResult>;

// ---------------------------------------------------------------------------
// Errors — structured, no UI copy (the i18n seam is at the UI boundary)
// ---------------------------------------------------------------------------

/**
 * Not logged in to douyin.com (or no usable douyin.com tab — thrown app-side
 * before the Platform Sync funnel). favbase never checks the Douyin login
 * before a request, so this is always `'missing'` (same as Zhihu).
 */
export class DouyinAuthError extends PlatformAuthError {
  constructor(message: string, reason: AuthFailReason) {
    super(message, reason);
    this.name = 'DouyinAuthError';
  }
}

/**
 * Risk control. `resetAt` = now + cooldown for a refusal or a withheld page;
 * null for a verification (captcha) the user must clear in the douyin.com tab.
 */
export class DouyinRateLimitError extends PlatformRateLimitError {
  constructor(message: string, resetAt: Date | null) {
    super(message, resetAt);
    this.name = 'DouyinRateLimitError';
  }
}

/** A non-zero `status_code` that is neither a login nor a verification (docs/33 F9). */
export class DouyinStatusError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly statusMsg: string,
  ) {
    super(message);
    this.name = 'DouyinStatusError';
  }
}

// ---------------------------------------------------------------------------
// Request construction (pure)
// ---------------------------------------------------------------------------

/** All favorites ("收藏 → 视频"): a form POST; `cursor` 0 first, then the response's µs cursor. */
export function buildCollectionRequest(cursor: string): DouyinRequest {
  return {
    method: 'POST',
    path: COLLECTION_PATH,
    query: { ...COMMON_QUERY, publish_video_strategy_type: '2' },
    form: { count: String(PAGE_SIZE), cursor },
    timeoutMs: resolveHttpDeadlineMs(),
  };
}

/** The user's folders (收藏夹); `offset` is an item offset from 0. */
export function buildFoldersRequest(offset: string): DouyinRequest {
  return {
    method: 'GET',
    path: FOLDERS_PATH,
    query: { ...COMMON_QUERY, cursor: offset, count: String(PAGE_SIZE) },
    timeoutMs: resolveHttpDeadlineMs(),
  };
}

/** One folder's items. `folderId` is `collects_id_str` (the int64 `collects_id` loses digits in JS). */
export function buildFolderItemsRequest(folderId: string, offset: string): DouyinRequest {
  return {
    method: 'GET',
    path: FOLDER_ITEMS_PATH,
    query: { ...COMMON_QUERY, collects_id: folderId, cursor: offset, count: String(PAGE_SIZE) },
    timeoutMs: resolveHttpDeadlineMs(),
  };
}

/**
 * One aweme by id (docs/37 §4.2): `aweme_id` + the three common parameters,
 * nothing else. The signature parameters are the page SDK's to add, exactly
 * as for the three list endpoints (docs/37 §3 iron rule 1).
 */
export function buildDetailRequest(awemeId: string): DouyinRequest {
  return {
    method: 'GET',
    path: DETAIL_PATH,
    query: { ...COMMON_QUERY, aweme_id: awemeId },
    timeoutMs: resolveHttpDeadlineMs(),
  };
}

// ---------------------------------------------------------------------------
// Response classification (docs/33 §4.4 — by shape, not by code)
// ---------------------------------------------------------------------------

/** A classified `status_code: 0` response: the raw text stays for error snippets (never re-stringify a 1.6 MB page). */
export interface DouyinEnvelope {
  status: number;
  text: string;
  json: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keys that mean "a verification is required" when they carry a value, at any depth. */
const VERIFY_KEYS: ReadonlySet<string> = new Set([
  'verify_check',
  'verify_center_decision_conf',
  'verify_ticket',
  'captcha',
]);

/**
 * Item lists hold user content (desc, nickname, folder name) — a string value
 * in there that mentions "captcha" is a video about captchas, not a challenge.
 * `aweme_detail` is the one item of a detail response (docs/37 D-h): without
 * it here, one caption about captchas fails that video's transcription as
 * "go verify".
 */
const ITEM_LIST_KEYS: ReadonlySet<string> = new Set(['aweme_list', 'collects_list', 'aweme_detail']);

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === '') {
    return false;
  }
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function scanVerify(node: unknown, inItems: boolean): string | null {
  if (typeof node === 'string') {
    if (inItems) return null;
    for (const marker of VERIFY_KEYS) if (node.includes(marker)) return marker;
    return null;
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = scanVerify(child, inItems);
      if (hit) return hit;
    }
    return null;
  }
  if (!isRecord(node)) return null;
  for (const [key, value] of Object.entries(node)) {
    if (VERIFY_KEYS.has(key) && hasValue(value)) return key;
    const hit = scanVerify(value, inItems || ITEM_LIST_KEYS.has(key));
    if (hit) return hit;
  }
  return null;
}

/**
 * The verification marker a response carries, or null. A marker KEY with a
 * value counts at any depth; a string VALUE naming a marker counts only
 * outside `aweme_list` / `collects_list` / `aweme_detail` (design C, docs/33
 * Step 1 record; the detail container added by docs/37 D-h). One pass over
 * the parsed body.
 */
export function findVerifyMarker(json: unknown): string | null {
  return scanVerify(json, false);
}

/** `resetAt` for a refusal or a withheld payload: now + the cooldown. */
export function cooldownFrom(now: () => number): Date {
  return new Date(now() + COOLDOWN_MS);
}

function transientBackoffMs(retry: number): number {
  return backoffDelayMs(retry, BACKOFF_BASE_MS, BACKOFF_JITTER_MS);
}

/** True for the not-logged-in shapes (docs/33 F7), matched by message as well as code. */
function isLoginRefusal(code: number, msg: string): boolean {
  return (code === 8 && msg.includes('未登录')) || code === 2483 || msg.includes('请先登录');
}

/**
 * Classify one transport result: a `status_code: 0` envelope, a `RetrySignal`
 * (5xx / unreachable / empty 200 — one shared budget), or a throw. Never
 * trusts a 200: an empty, non-JSON, verification-bearing or code-less body
 * is an error, never an empty result. `now` feeds the cooldown `resetAt`.
 */
export function classifyResponse(
  result: DouyinTransportResult,
  what: string,
  now: () => number = Date.now,
): DouyinEnvelope | RetrySignal {
  if (result.kind === 'sdk-not-ready') {
    throw new Error(
      `${what}: the douyin.com page SDK is not ready (window fetch is still native) — reload the douyin.com tab`,
    );
  }
  if (result.kind === 'unreachable') {
    const cause = result.message;
    return retryAfter(transientBackoffMs, () => new Error(`${what}: request did not complete: ${cause}`));
  }

  const { status, text } = result;
  const snippet = textSnippet(text);

  if (status === 403 && text.includes('ArgusSecurityPlugin')) {
    // Deterministic signature refusal: favbase or the page SDK changed. Retrying only burns the window.
    throw new Error(`${what}: HTTP 403 signature refused by ArgusSecurityPlugin: ${snippet}`);
  }
  if (status === 403 || status === 429) {
    throw new DouyinRateLimitError(`${what}: HTTP ${status} (risk control): ${snippet}`, cooldownFrom(now));
  }
  if (status >= 500) {
    return retryAfter(transientBackoffMs, () => new Error(`${what}: HTTP ${status}: ${snippet}`));
  }
  if (status < 200 || status >= 300) {
    throw new Error(`${what}: HTTP ${status}: ${snippet}`);
  }

  if (!text.trim()) {
    return retryAfter(
      transientBackoffMs,
      () =>
        new DouyinRateLimitError(
          `${what}: HTTP ${status} with an empty body after ${MAX_RETRIES} retries (payload withheld — risk control?)`,
          cooldownFrom(now),
        ),
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // A challenge page. The user clears it in the douyin.com tab; no reset time is known.
    throw new DouyinRateLimitError(
      `${what}: HTTP ${status} with a non-JSON body (verification page?): ${snippet}`,
      null,
    );
  }

  const marker = findVerifyMarker(json);
  if (marker) {
    throw new DouyinRateLimitError(
      `${what}: HTTP ${status} verification required (${marker}): ${snippet}`,
      null,
    );
  }
  if (!isRecord(json) || typeof json.status_code !== 'number') {
    throw new Error(`${what}: HTTP ${status} unexpected response shape (no status_code): ${snippet}`);
  }

  const code = json.status_code;
  const msg = typeof json.status_msg === 'string' ? json.status_msg : '';
  if (code !== 0) {
    const detail = `HTTP ${status} status_code ${code}${msg ? ` (${msg})` : ''}: ${snippet}`;
    if (isLoginRefusal(code, msg)) {
      throw new DouyinAuthError(`${what}: not logged in to douyin.com — ${detail}`, 'missing');
    }
    throw new DouyinStatusError(`${what}: ${detail}`, code, msg);
  }

  return { status, text, json };
}

// ---------------------------------------------------------------------------
// Pacing (docs/33 §4.5, design A: every real request, retries included)
// ---------------------------------------------------------------------------

export interface DouyinPacer {
  /** Await before EVERY request a run sends (retries included). */
  beforeRequest(): Promise<void>;
}

/**
 * One pacer per run, shared by all three endpoints (one serial chain). The
 * first request does not wait; each later one waits `jitteredDelayMs(PAGE_DELAY_MIN,
 * PAGE_DELAY_JITTER)`, and after every `REST_EVERY_PAGES` requests the next
 * one also rests `jitteredDelayMs(REST_MIN, REST_JITTER)`. `sleep` / `random`
 * are injectable so tests never wait.
 */
export function createDouyinPacer(
  deps: { sleep?: (ms: number) => Promise<void>; random?: () => number } = {},
): DouyinPacer {
  const wait = deps.sleep ?? sleep;
  const random = deps.random ?? Math.random;
  let sent = 0;
  return {
    async beforeRequest() {
      if (sent > 0) {
        await wait(jitteredDelayMs(PAGE_DELAY_MIN_MS, PAGE_DELAY_JITTER_MS, random));
        if (REST_EVERY_PAGES > 0 && sent % REST_EVERY_PAGES === 0) {
          await wait(jitteredDelayMs(REST_MIN_MS, REST_JITTER_MS, random));
        }
      }
      sent += 1;
    },
  };
}

// ---------------------------------------------------------------------------
// One request
// ---------------------------------------------------------------------------

/** What one sync run threads through every request. */
export interface DouyinSession {
  transport: DouyinTransport;
  pacer: DouyinPacer;
  control?: CooperativeCheckpoint;
  /** Clock for cooldown `resetAt`; defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Send one request with pacing and the shared transient-retry budget, and
 * return its `status_code: 0` envelope. Each attempt: `withRetries`'
 * checkpoint → pacer wait → a second checkpoint (a pause requested during a
 * three-minute rest must hold before the request goes out) → transport →
 * `classifyResponse`. Two checkpoints per attempt is deliberate.
 */
export async function requestEnvelope(
  session: DouyinSession,
  req: DouyinRequest,
  what: string,
): Promise<DouyinEnvelope> {
  const now = session.now ?? Date.now;
  return withRetries({ maxRetries: MAX_RETRIES, control: session.control }, async () => {
    await session.pacer.beforeRequest();
    await session.control?.checkpoint();
    return classifyResponse(await session.transport(req), what, now);
  });
}

// ---------------------------------------------------------------------------
// Parsers (pure)
// ---------------------------------------------------------------------------

/** One favorited aweme (作品), normalized — the fetch layer's output contract. */
export interface DouyinRawAweme {
  /** `aweme_id` — always the string; a numeric id has already lost digits. */
  id: string;
  desc: string;
  /** Publish time in unix seconds; Douyin gives no per-item favorite time. */
  createTime: number | null;
  /** `secUid` is the stable author id (`uid` rotates); '' when absent. */
  author: { secUid: string; nickname: string; avatarUrl: string };
  coverUrl: string | null;
  /** `video.duration`, milliseconds; null for image posts (duration 0). */
  durationMs: number | null;
  /** Non-empty `images` = an image post (图文 / 实况). */
  mediaKind: 'video' | 'note';
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function firstUrl(value: unknown): string | null {
  if (!isRecord(value) || !Array.isArray(value.url_list)) return null;
  const url = value.url_list[0];
  return typeof url === 'string' && url ? url : null;
}

/** Map one `aweme_list` entry; null when it has no string `aweme_id`. */
export function mapAweme(raw: unknown): DouyinRawAweme | null {
  if (!isRecord(raw) || typeof raw.aweme_id !== 'string' || !raw.aweme_id) return null;
  const author = isRecord(raw.author) ? raw.author : {};
  const video = isRecord(raw.video) ? raw.video : {};
  const images = Array.isArray(raw.images) ? raw.images : [];
  const createTime = raw.create_time;
  const duration = video.duration;
  return {
    id: raw.aweme_id,
    desc: str(raw.desc),
    createTime:
      typeof createTime === 'number' && Number.isFinite(createTime) && createTime > 0
        ? createTime
        : null,
    author: {
      secUid: str(author.sec_uid),
      nickname: str(author.nickname),
      avatarUrl: firstUrl(author.avatar_thumb) ?? '',
    },
    coverUrl: firstUrl(video.cover) ?? firstUrl(video.origin_cover) ?? firstUrl(images[0]),
    durationMs: typeof duration === 'number' && Number.isFinite(duration) && duration > 0 ? duration : null,
    mediaKind: images.length > 0 ? 'note' : 'video',
  };
}

/** One folder (收藏夹). */
export interface DouyinFolder {
  /** `collects_id_str` — never the int64 `collects_id`. */
  id: string;
  title: string;
  /** `status === 1` only; 0 is private, anything else is unmeasured and NOT treated as public. */
  isPublic: boolean;
}

/** Map one `collects_list` entry; null when it has no `collects_id_str`. */
export function mapFolder(raw: unknown): DouyinFolder | null {
  if (!isRecord(raw) || typeof raw.collects_id_str !== 'string' || !raw.collects_id_str) {
    return null;
  }
  return {
    id: raw.collects_id_str,
    title: str(raw.collects_name) || raw.collects_id_str,
    isPublic: raw.status === 1,
  };
}

// ---------------------------------------------------------------------------
// Page decoding (shape checks — never trust a 200)
// ---------------------------------------------------------------------------

type ListKey = 'aweme_list' | 'collects_list';

interface DecodedPage {
  entries: unknown[];
  hasMore: boolean;
  /** The cursor that fetches the next page; null when `hasMore` is false. */
  nextCursor: string | null;
  /** Entries Douyin cut out of the list as 失效 (`disabled_item_ids` / `invalid_item_id_list`). */
  invalidCount: number;
}

/** `has_more` is a bool on collects/list and 0/1 elsewhere — accept both, nothing else. */
function decodeHasMore(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

/**
 * A cursor as a digit string: a safe-integer number or a digit string; null
 * otherwise. Every cursor that reaches `BigInt` passes through here — the
 * response's, and (in the sync service) the stored breakpoint's.
 */
export function decodeCursor(value: unknown): string | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

/**
 * Decode one list page, or `'withheld'`: `status_code: 0`, nothing in the
 * list and `has_more` set, with no 失效 ids to explain it — the shape risk
 * control takes (docs/33 F8). `null` / absent list + `has_more` false is a
 * legal zero (`collects_list: null` + `total_number: 0` is the measured
 * no-folder shape, probe #3). A missing or undecodable `has_more` is an error.
 */
function decodeListPage(env: DouyinEnvelope, listKey: ListKey, what: string): DecodedPage | 'withheld' {
  const { json } = env;
  const hasMore = decodeHasMore(json.has_more);
  if (hasMore === null) {
    throw new Error(
      `${what}: HTTP ${env.status} unexpected response shape (no usable has_more): ${textSnippet(env.text)}`,
    );
  }
  const list = json[listKey];
  if (list !== null && list !== undefined && !Array.isArray(list)) {
    throw new Error(
      `${what}: HTTP ${env.status} unexpected response shape (${listKey} is not a list): ${textSnippet(env.text)}`,
    );
  }
  const entries = list ?? [];
  const invalidCount = arrayLength(json.disabled_item_ids) + arrayLength(json.invalid_item_id_list);
  if (entries.length === 0 && hasMore && invalidCount === 0) return 'withheld';

  let nextCursor: string | null = null;
  if (hasMore) {
    nextCursor = decodeCursor(json.cursor);
    if (nextCursor === null) {
      throw new Error(
        `${what}: HTTP ${env.status} has_more without a usable cursor: ${textSnippet(env.text)}`,
      );
    }
  }
  return { entries, hasMore, nextCursor, invalidCount };
}

/**
 * Does `next` move past `prev`? listcollection's cursor is a µs timestamp that
 * falls page by page; `'0'` means "from the top", so it is never a valid NEXT
 * cursor there — accepting it would send the walk back to the newest page and
 * loop until the fuse. The folder endpoints' cursor is an offset that rises.
 * Compared as BigInt (a 16-digit cursor is past 2^53 one day; today it is
 * not, but the comparison costs nothing).
 */
function advances(prev: string, next: string, order: 'descending' | 'ascending'): boolean {
  const p = BigInt(prev);
  const n = BigInt(next);
  if (order === 'ascending') return n > p;
  return n > BigInt(0) && (prev === '0' || n < p);
}

// ---------------------------------------------------------------------------
// Walks
// ---------------------------------------------------------------------------

/** One decoded page of awemes (listcollection or a folder). */
export interface DouyinAwemePage {
  awemes: DouyinRawAweme[];
  hasMore: boolean;
  /** Cursor for the next page; null at the end. */
  nextCursor: string | null;
  invalidCount: number;
}

/** How a walk ended: `has_more: 0`, `onPage` said stop, or the page fuse. */
export type DouyinWalkEnd = 'end' | 'stopped' | 'fuse';

export type DouyinPageHandler = (page: DouyinAwemePage) => Promise<'continue' | 'stop'>;

interface WalkSpec<T> {
  what: string;
  listKey: ListKey;
  order: 'descending' | 'ascending';
  build: (cursor: string) => DouyinRequest;
  map: (entry: unknown) => T | null;
}

interface WalkPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
  invalidCount: number;
}

/**
 * `onStartCursorRejected` runs only for the FIRST request — the one that
 * carries `startCursor`, its transient retries included — and only before an
 * F8 (withheld), F9 (status error) or F10 (the next cursor does not move past
 * `startCursor`: the server did not take it) propagates. Later pages use a
 * cursor the server handed out moments ago, so a refusal there is risk
 * control, not a stale `startCursor` (docs/33 D-e, narrowed to the first
 * request and widened to F10 at the Step 1 review).
 */
async function walkPages<T>(
  session: DouyinSession,
  spec: WalkSpec<T>,
  startCursor: string,
  onPage: (page: WalkPage<T>) => Promise<'continue' | 'stop'>,
  onStartCursorRejected?: () => Promise<void>,
): Promise<DouyinWalkEnd> {
  const now = session.now ?? Date.now;
  let cursor = startCursor;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const rejected = pages === 0 ? onStartCursorRejected : undefined;
    let env: DouyinEnvelope;
    try {
      env = await requestEnvelope(session, spec.build(cursor), spec.what);
    } catch (err) {
      if (err instanceof DouyinStatusError) await rejected?.();
      throw err;
    }

    const decoded = decodeListPage(env, spec.listKey, spec.what);
    if (decoded === 'withheld') {
      await rejected?.();
      throw new DouyinRateLimitError(
        `${spec.what}: HTTP ${env.status} empty ${spec.listKey} with has_more set and no 失效 ids (payload withheld — risk control?): ${textSnippet(env.text)}`,
        cooldownFrom(now),
      );
    }
    if (decoded.nextCursor !== null && !advances(cursor, decoded.nextCursor, spec.order)) {
      await rejected?.();
      throw new Error(
        `${spec.what}: cursor did not advance (${cursor} → ${decoded.nextCursor}): ${textSnippet(env.text)}`,
      );
    }

    const items: T[] = [];
    for (const entry of decoded.entries) {
      const item = spec.map(entry);
      if (item) items.push(item);
    }
    const page = { items, hasMore: decoded.hasMore, nextCursor: decoded.nextCursor, invalidCount: decoded.invalidCount };
    if ((await onPage(page)) === 'stop') return 'stopped';
    if (decoded.nextCursor === null) return 'end';
    cursor = decoded.nextCursor;
  }
  return 'fuse';
}

function awemePageHandler(onPage: DouyinPageHandler) {
  return (page: WalkPage<DouyinRawAweme>) =>
    onPage({
      awemes: page.items,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      invalidCount: page.invalidCount,
    });
}

/**
 * Walk the all-favorites list from `startCursor` (`'0'` = the newest) towards
 * older favorites. `onStartCursorRejected` runs before a withheld page (F8),
 * a status error (F9) or a cursor that does not advance (F10) on the FIRST
 * request propagates — the sync passes it only for a resumed walk, whose
 * stored cursor may have expired (docs/33 D-e).
 */
export function walkCollection(
  session: DouyinSession,
  startCursor: string,
  onPage: DouyinPageHandler,
  opts: { onStartCursorRejected?: () => Promise<void> } = {},
): Promise<DouyinWalkEnd> {
  return walkPages(
    session,
    {
      what: WHAT_COLLECTION,
      listKey: 'aweme_list',
      order: 'descending',
      build: buildCollectionRequest,
      map: mapAweme,
    },
    startCursor,
    awemePageHandler(onPage),
    opts.onStartCursorRejected,
  );
}

/** Walk one folder's items by offset, start to end. */
export function walkFolderItems(
  session: DouyinSession,
  folderId: string,
  onPage: DouyinPageHandler,
): Promise<DouyinWalkEnd> {
  return walkPages(
    session,
    {
      what: WHAT_FOLDER_ITEMS,
      listKey: 'aweme_list',
      order: 'ascending',
      build: (offset) => buildFolderItemsRequest(folderId, offset),
      map: mapAweme,
    },
    '0',
    awemePageHandler(onPage),
  );
}

/** Every public (`status === 1`) folder of the logged-in user. An empty folder is still returned. */
export async function fetchPublicFolders(session: DouyinSession): Promise<DouyinFolder[]> {
  const folders: DouyinFolder[] = [];
  await walkPages(
    session,
    {
      what: WHAT_FOLDERS,
      listKey: 'collects_list',
      order: 'ascending',
      build: buildFoldersRequest,
      map: mapFolder,
    },
    '0',
    async (page) => {
      for (const folder of page.items) if (folder.isPublic) folders.push(folder);
      return 'continue';
    },
  );
  return folders;
}
