/**
 * Bookmark page fetch + main-content extraction — the pure layer of the
 * bookmarks content pipeline (ZERO DB imports, zero UI copy; structured
 * result values only — the i18n seam stays at the UI boundary). The serial
 * worker in ./bookmark-content-service.ts orchestrates this against the
 * extraction queue in ./bookmarks-sync-service.ts.
 *
 * Decisions follow the task research (batch-fetch-pitfalls / defuddle):
 * - single GET, content-type decided from the response headers BEFORE reading
 *   the body (HEAD preflights 405/hang/lie on many servers);
 * - `credentials:'omit'` — host-permission fetches attach the user's cookies
 *   by default (undocumented Chrome behavior); the crawl must stay anonymous
 *   so logged-in/private HTML never lands in PGlite;
 * - streamed body with a byte cap (Content-Length is often absent);
 * - bytes → string via charset sniffing (`response.text()` hard-codes UTF-8,
 *   which mojibakes GBK/Big5/Shift_JIS pages);
 * - Defuddle full bundle (`markdown:true`) on a detached DOMParser document,
 *   ALWAYS passing `url` so relative links resolve; sync `parse()` only —
 *   `parseAsync`'s site extractors may fetch third-party APIs;
 * - `parse()` never throws and falls back to the whole cleaned <body> on
 *   non-article pages — a char threshold decides "no content" (SPA shells,
 *   challenge pages, landing pages).
 */

import Defuddle from 'defuddle/full';

/** Per-request timeout — slow-but-alive servers answer within this; blackholed IPs don't. */
export const FETCH_TIMEOUT_MS = 15_000;
/** Byte cap on the fetched body — generous for real HTML, guards DOMParser/Defuddle cost. */
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** Minimum trimmed Markdown length to count as real content. */
export const MIN_CONTENT_CHARS = 200;

/** Spec'd prescan window for an in-document charset declaration. */
const META_PRESCAN_BYTES = 1024;

export type FetchPageResult =
  | { kind: 'ok'; html: string }
  | { kind: 'permanent'; reason: 'http-4xx' | 'not-html' | 'too-large' }
  | { kind: 'transient'; reason: 'http-5xx' | 'http-429' | 'timeout' | 'network' };

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// URL pre-filter
// ---------------------------------------------------------------------------

const PRIVATE_IPV4 = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16.0.0/12
  /^169\.254\./, // link-local
];

/**
 * True when the URL is worth a fetch attempt. Rejects non-http(s) schemes,
 * localhost / `.local` / dotless intranet hostnames, and literal private or
 * loopback IPs (router panels, dead NAS links — garbage data, not content).
 * Hostname-shape checks only: an extension cannot resolve DNS, so a public
 * hostname pointing at a private IP is an accepted gap.
 */
export function classifyUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (host.startsWith('[')) {
    // Literal IPv6 (URL keeps the brackets) — reject loopback / link-local /
    // unique-local, allow global addresses.
    const v6 = host.slice(1, -1);
    return !(v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd'));
  }
  if (host === 'localhost' || host.endsWith('.local')) return false;
  if (!host.includes('.')) return false; // dotless intranet names (http://wiki/)
  if (PRIVATE_IPV4.some((re) => re.test(host))) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Charset-aware decoding
// ---------------------------------------------------------------------------

/** Strip quotes, lowercase, and alias gb2312/gbk → gb18030 (superset). */
function normalizeCharset(label: string): string {
  const l = label.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return l === 'gb2312' || l === 'gbk' ? 'gb18030' : l;
}

function decodeWith(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    // Unknown/invalid label → utf-8 fallback.
    return new TextDecoder('utf-8').decode(bytes);
  }
}

/**
 * Bytes → string mirroring the WHATWG encoding-sniffing order:
 * BOM → Content-Type header charset → meta prescan of the first 1024 bytes →
 * utf-8 default. Pure; exported for unit tests (GBK byte fixtures).
 */
export function decodeHtmlBytes(buffer: ArrayBuffer, contentTypeHeader: string | null): string {
  const bytes = new Uint8Array(buffer);

  // 1. BOM wins over everything (TextDecoder strips it by default).
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decodeWith(bytes, 'utf-8');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeWith(bytes, 'utf-16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeWith(bytes, 'utf-16be');

  // 2. Content-Type header charset param.
  const headerMatch = /charset\s*=\s*("[^"]*"|'[^']*'|[^;\s]+)/i.exec(contentTypeHeader ?? '');
  if (headerMatch) return decodeWith(bytes, normalizeCharset(headerMatch[1]));

  // 3. Meta prescan — decode the window byte-transparently (latin1), regex for
  //    <meta charset="..."> or <meta http-equiv content="...; charset=...">.
  const prescan = new TextDecoder('latin1').decode(bytes.subarray(0, META_PRESCAN_BYTES));
  const metaMatch = /<meta[^>]+charset\s*=\s*("[^"]*"|'[^']*'|[\w-]+)/i.exec(prescan);
  if (metaMatch) return decodeWith(bytes, normalizeCharset(metaMatch[1]));

  // 4. Default.
  return decodeWith(bytes, 'utf-8');
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

/** Read the body with a byte cap; null = cap exceeded (reader cancelled). */
async function readBodyCapped(res: Response, maxBytes: number): Promise<ArrayBuffer | null> {
  if (!res.body) return res.arrayBuffer(); // no stream (empty body / test stubs)

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out.buffer;
}

/**
 * Anonymous GET of a bookmark page with the full pitfall guard set (timeout,
 * content-type check before body read, byte cap, charset-aware decode).
 * Never throws — every failure maps onto the permanent/transient taxonomy:
 * permanent (4xx / non-HTML / oversized) means the caller settles the item as
 * no_content; transient (5xx / 429 / timeout / network) means it stays pending.
 * `fetchFn` exists for test injection.
 */
export async function fetchBookmarkPage(
  url: string,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): Promise<FetchPageResult> {
  try {
    const res = await fetchFn(url, {
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    });

    if (res.status >= 500) return { kind: 'transient', reason: 'http-5xx' };
    // Rate limiting means the content EXISTS — settling it as no_content would
    // permanently drop it (research taxonomy: 429 is transient, not 4xx-dead).
    if (res.status === 429) return { kind: 'transient', reason: 'http-429' };
    if (!res.ok) return { kind: 'permanent', reason: 'http-4xx' };

    const contentType = res.headers.get('content-type');
    const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
    // Missing content-type is common on old servers — treat as probably-HTML.
    if (mediaType && mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') {
      await res.body?.cancel().catch(() => {});
      return { kind: 'permanent', reason: 'not-html' };
    }

    const buffer = await readBodyCapped(res, MAX_HTML_BYTES);
    if (buffer === null) return { kind: 'permanent', reason: 'too-large' };
    return { kind: 'ok', html: decodeHtmlBytes(buffer, contentType) };
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'transient', reason: 'timeout' };
    }
    return { kind: 'transient', reason: 'network' }; // DNS / refused / TLS / reset
  }
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Threshold guard — Defuddle's `parse()` never fails, so "extraction found
 * nothing" is the CALLER's judgement. Exported pure for unit tests.
 */
export function meetsContentThreshold(markdown: string): boolean {
  return markdown.trim().length >= MIN_CONTENT_CHARS;
}

function removeMalformedSchemaOrgScripts(doc: Document): void {
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    const normalized = (script.textContent ?? '')
      .replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '')
      .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
      .replace(/^\s*(\*\/|\/\*)\s*|\s*(\*\/|\/\*)\s*$/g, '')
      .trim();
    try { JSON.parse(normalized); } catch { script.remove(); }
  });
}

/**
 * Cleaned main content as Markdown, or null when the page has no real content
 * (SPA shell, challenge page, near-empty body). `url` is mandatory — without
 * it Defuddle cannot resolve relative links (a DOMParser doc has no base URL).
 */
export function extractMarkdown(html: string, url: string): { markdown: string } | null {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  removeMalformedSchemaOrgScripts(doc);
  // Sync parse() only — parseAsync's extractors may call third-party APIs.
  const result = new Defuddle(doc, { url, markdown: true }).parse();
  const markdown = (result.content ?? '').trim();
  return meetsContentThreshold(markdown) ? { markdown } : null;
}
