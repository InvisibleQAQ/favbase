/**
 * X (Twitter) auth capture — mirrors supermemory's browser-extension approach
 * (utils/twitter-auth.ts + utils/storage.ts). X has no free official API, so we
 * replay the EXACT headers the logged-in web client sends: the full `Cookie`
 * string, the `x-csrf-token` (ct0), and the `authorization` bearer.
 *
 * Why capture instead of `chrome.cookies.get` (the previous approach): the web
 * client's Cookie header carries many httpOnly / SameSite=Lax cookies
 * (guest_id, twid, kdt, att, …) that a cross-origin extension fetch cannot get
 * from the jar and that a hand-built `auth_token; ct0` pair omits — X's
 * GraphQL endpoint then returns empty/blocked. Capturing the real request
 * headers verbatim sidesteps all of that (this was the 07-16 "0 fetched" root
 * cause).
 *
 * Tokens are session-scoped (chrome.storage.session — cleared on browser
 * close): the background webRequest listener writes them; `getXAuth()` is read
 * from storage-capable contexts only (app.html page, background SW). Offscreen
 * documents have NO chrome.storage — the SW resolves auth and passes it into
 * `syncBookmarks` via the OFFSCREEN_X_SYNC message. Requires the user to have
 * x.com open/browsed at least once this session before a sync can run
 * (surfaced as the "login" empty state).
 */

import { storage } from 'wxt/utils/storage';
// Import from the leaf keys module (not the '@/lib/storage' barrel) so the SW /
// background graph doesn't pull in the settings-migration side effects.
import { STORAGE_KEYS } from '@/lib/storage/keys';

/** Captured X request auth, replayed verbatim on our GraphQL fetch. */
export interface XAuth {
  /** Full `Cookie` header from a real x.com request (all cookies, not just 2). */
  cookie: string;
  /** `x-csrf-token` header (equals the ct0 cookie — X double-submit CSRF). */
  csrf: string;
  /** Full `authorization` header value, e.g. `Bearer AAAA…` (the public web bearer). */
  auth: string;
}

// Lazily defined: WXT's `storage.defineItem` eagerly hits `getItem` on
// creation, which throws outside a web-extension env (e.g. unit tests that
// import this module transitively but never touch auth). Deferring the define
// to first real use keeps module import side-effect-free.
type StringItem = ReturnType<typeof storage.defineItem<string>>;
let items: { cookie: StringItem; csrf: StringItem; auth: StringItem } | null = null;
function xItems() {
  if (!items) {
    items = {
      cookie: storage.defineItem<string>(STORAGE_KEYS.xCookie),
      csrf: storage.defineItem<string>(STORAGE_KEYS.xCsrf),
      auth: storage.defineItem<string>(STORAGE_KEYS.xAuth),
    };
  }
  return items;
}

/** Minimal shape of a webRequest onBeforeSendHeaders event (extraHeaders spec). */
interface RequestHeadersDetails {
  url: string;
  requestHeaders?: { name?: string; value?: string }[];
}

/** In-memory dedupe so we don't thrash session storage on every x.com API call. */
let lastCapturedKey = '';

/**
 * Capture `authorization` + `cookie` + `x-csrf-token` from a real x.com request
 * and persist them (only when all three are present — that naturally selects
 * authenticated API/GraphQL requests over static asset loads). Returns whether
 * a (new) token set was written. Called by the background webRequest listener.
 */
export async function captureXTokens(details: RequestHeadersDetails): Promise<boolean> {
  if (!(details.url.includes('x.com') || details.url.includes('twitter.com'))) {
    return false;
  }

  let auth: string | undefined;
  let cookie: string | undefined;
  let csrf: string | undefined;

  for (const header of details.requestHeaders ?? []) {
    if (!header.name) continue;
    switch (header.name.toLowerCase()) {
      case 'authorization':
        auth = header.value;
        break;
      case 'cookie':
        cookie = header.value;
        break;
      case 'x-csrf-token':
        csrf = header.value;
        break;
    }
    if (auth && cookie && csrf) break;
  }

  if (!auth || !cookie || !csrf) return false;

  // Skip the write when nothing changed (webRequest fires per API call).
  const key = `${csrf}::${cookie.length}`;
  if (key === lastCapturedKey) return false;
  lastCapturedKey = key;

  const s = xItems();
  await Promise.all([
    s.cookie.setValue(cookie),
    s.csrf.setValue(csrf),
    s.auth.setValue(auth),
  ]);
  return true;
}

/**
 * Read the captured X auth. Null when any piece is missing — the user hasn't
 * browsed x.com (logged in) this session yet, which the sync surfaces as
 * `XAuthError` → the "open x.com" empty state.
 */
export async function getXAuth(): Promise<XAuth | null> {
  const s = xItems();
  const [cookie, csrf, auth] = await Promise.all([
    s.cookie.getValue(),
    s.csrf.getValue(),
    s.auth.getValue(),
  ]);
  if (!cookie || !csrf || !auth) return null;
  return { cookie, csrf, auth };
}
