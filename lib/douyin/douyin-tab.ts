/**
 * Douyin tab transport — the ONLY module in lib/douyin that touches `chrome.*`
 * (docs/33 D3 / D4 / D-c). The sync runs in app.html, but every favorites
 * request has to leave from the user's own logged-in www.douyin.com tab: since
 * 2026-08-16/17 the three endpoints are in the page SDK's `webSign` protected
 * list, so a request is only signed (`a_bogus`, `x-secsdk-web-signature`) when
 * it goes through the `window.fetch` the SDK has wrapped. `executeScript`
 * injects `douyinPageFetch` into that tab's MAIN world and hands its result
 * back.
 *
 * Why here and not in `entrypoints/app/sections/douyin/` (user decision
 * 2026-10-03): a platform's request and timing code stays inside the
 * `lib/<p>/` guards (sleep, env constants, bare-fetch allowlist), and this is
 * the platform's real request path. It is a separate leaf — like `lib/x/x-auth.ts` — and neither
 * `douyin-api.ts` nor `douyin-sync-service.ts` may import it: the import-smoke
 * contract loads the sync service with no `chrome` global. The flip side: the
 * smoke test never loads THIS file; its own tests cover it.
 *
 * Three readers, one resolver (D-c): the Sync Adapter's tab gate, the daily
 * auto-sync `probeReady` and this transport all call `findDouyinTab()`, so
 * "ready" never means a discarded or still-loading tab that the transport
 * would then fail on. The transport resolves the tab per request: a tab closed
 * or discarded mid-run surfaces as `unreachable` (the shared retry budget),
 * never as a stale id.
 *
 * Never touches the tab itself — no reload, no navigation, no activation
 * (docs/33 iron rule 6).
 */

import { browser } from 'wxt/browser';

// The descriptor file is a pure leaf (its only value import is ./platforms).
import { PLATFORM_DESCRIPTORS } from '@/lib/collections/platform-descriptor';
import { sleep } from '@/lib/http/backoff';

import type { DouyinRequest, DouyinTransport, DouyinTransportResult } from './douyin-api';

/**
 * Match pattern of the tabs the requests may run in: the platform's one host
 * permission, read from the descriptor rather than spelled again here. (Also
 * keeps a slash-star string literal out of this file: the env-constant and
 * bare-fetch guards strip comments with a naive block-comment regex, and such
 * a literal would hide the lines after it from both.)
 */
const [DOUYIN_TAB_URL] = PLATFORM_DESCRIPTORS.douyin.hostPermissions;
// The match pattern ends in `*`; without it, it is the URL prefix of a tab on
// the site (derived, so no slash-star literal appears here either).
const DOUYIN_TAB_URL_PREFIX = DOUYIN_TAB_URL.slice(0, -1);

/**
 * The id of the first usable www.douyin.com tab, or null. Usable = not
 * discarded by Memory Saver and done loading (`status === 'complete'`): the
 * SDK wraps `fetch` while the page loads, and a discarded tab has no page to
 * inject into. The host permission is enough to read these tabs' URLs; no
 * `tabs` permission is needed.
 */
export async function findDouyinTab(): Promise<number | null> {
  const tabs = await browser.tabs.query({ url: DOUYIN_TAB_URL });
  for (const tab of tabs) {
    if (tab.id !== undefined && !tab.discarded && tab.status === 'complete') return tab.id;
  }
  return null;
}

/**
 * Resolves on the next completed load of a www.douyin.com tab
 * (`tabs.onUpdated` with `status: 'complete'`): the cheapest evidence that the
 * user acted on the tab — signed in, passed a check, reloaded it. The
 * auto-transcribe adapter waits on it for a `login` / `verify` / signature
 * prerequisite (docs/37 Step 3 ruling 5); polling `findDouyinTab()` would
 * resolve at once while the logged-out tab is still open, re-queue the item,
 * and send one more signed request into the same wall. A check passed
 * in-page without a reload is NOT seen: the banner tells the user to reload.
 * Never touches the tab.
 */
export function waitForDouyinTabLoad(): Promise<void> {
  return new Promise((resolve) => {
    const onUpdated = (
      _tabId: number,
      changeInfo: { status?: string },
      tab: { url?: string },
    ): void => {
      if (changeInfo.status !== 'complete' || !tab.url?.startsWith(DOUYIN_TAB_URL_PREFIX)) return;
      browser.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    };
    browser.tabs.onUpdated.addListener(onUpdated);
  });
}

/**
 * Runs INSIDE the douyin.com page's MAIN world, never in the extension.
 * `executeScript` serializes it with `Function.prototype.toString`, so it must
 * be self-contained: no closure, no import, no module-level constant, no
 * helper — only its parameter and browser globals (a build helper such as
 * `__name(...)` would be a ReferenceError in the page; the extension CSP
 * rules out rebuilding it with `new Function`). Its result crosses back by
 * structured clone, so it returns plain objects only. Never throws.
 *
 * The page's `window.fetch` is the one the SDK wrapped; a native one means the
 * SDK is not up yet and nothing would be signed. The request carries business
 * parameters only — the SDK adds every signature parameter itself.
 */
export async function douyinPageFetch(req: DouyinRequest): Promise<DouyinTransportResult> {
  if (Function.prototype.toString.call(window.fetch).indexOf('[native code]') !== -1) {
    return { kind: 'sdk-not-ready' };
  }
  try {
    const response = await window.fetch(req.path + '?' + new URLSearchParams(req.query).toString(), {
      method: req.method,
      credentials: 'include',
      headers: req.form ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      body: req.form ? new URLSearchParams(req.form).toString() : undefined,
      signal: AbortSignal.timeout(req.timeoutMs),
    });
    return { kind: 'response', status: response.status, text: await response.text() };
  } catch (err) {
    return {
      kind: 'unreachable',
      message: err instanceof Error ? err.name + ': ' + err.message : String(err),
    };
  }
}

function describe(value: unknown): string {
  if (value === undefined) return 'nothing';
  try {
    return JSON.stringify(value).slice(0, 120);
  } catch {
    return typeof value;
  }
}

/**
 * Decode what came back across the `executeScript` boundary. It is `unknown`
 * there — a frame that errored yields no result, a page script could have
 * shadowed something — so anything that is not one of the three shapes folds
 * into `unreachable` instead of being trusted.
 */
export function decodePageFetchResult(value: unknown): DouyinTransportResult {
  if (typeof value === 'object' && value !== null) {
    const result = value as Record<string, unknown>;
    if (result.kind === 'sdk-not-ready') return { kind: 'sdk-not-ready' };
    if (result.kind === 'unreachable' && typeof result.message === 'string') {
      return { kind: 'unreachable', message: result.message };
    }
    if (result.kind === 'response' && typeof result.status === 'number' && typeof result.text === 'string') {
      return { kind: 'response', status: result.status, text: result.text };
    }
  }
  return { kind: 'unreachable', message: `the injected request returned ${describe(value)}` };
}

async function injectFetch(tabId: number, req: DouyinRequest): Promise<DouyinTransportResult> {
  const [injection] = await browser.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: douyinPageFetch,
    args: [req],
  });
  return decodePageFetchResult(injection?.result);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * The `DouyinTransport` the app hands to `syncDouyinCollections`. Never
 * throws: no usable tab, a failed injection (tab closed, navigated away,
 * discarded) and a timeout are all `unreachable`. The deadline is enforced
 * twice with the same `req.timeoutMs`: inside the page (`AbortSignal.timeout`)
 * and out here, because a frozen background tab never fires the inner one.
 * Whichever lands first, the answer is `unreachable`.
 */
export const douyinTabTransport: DouyinTransport = async (req) => {
  try {
    const tabId = await findDouyinTab();
    if (tabId === null) {
      return {
        kind: 'unreachable',
        message: 'no usable www.douyin.com tab (closed, discarded or still loading)',
      };
    }
    return await Promise.race([
      injectFetch(tabId, req),
      sleep(req.timeoutMs).then(
        (): DouyinTransportResult => ({
          kind: 'unreachable',
          message: `no answer from the douyin.com tab within ${req.timeoutMs} ms`,
        }),
      ),
    ]);
  } catch (err) {
    return { kind: 'unreachable', message: `could not run the request in the douyin.com tab: ${errorMessage(err)}` };
  }
};
