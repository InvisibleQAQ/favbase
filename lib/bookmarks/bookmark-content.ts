/**
 * Bookmark URL classification + main-content extraction — the pure DOM layer of the
 * bookmarks content pipeline (ZERO DB imports, zero UI copy; structured
 * result values only — the i18n seam stays at the UI boundary). The serial
 * worker in ./bookmark-content-service.ts orchestrates this against the
 * extraction queue in ./bookmarks-sync-service.ts.
 *
 * Decisions follow the task research (batch-fetch-pitfalls / defuddle):
 * - network retrieval lives in bookmark-page-fetch.ts and production invokes
 *   it through the background SW, never from app.html;
 * - Defuddle full bundle (`markdown:true`) on an inert linkedom document,
 *   ALWAYS passing `url` so relative links resolve; sync `parse()` only —
 *   `parseAsync`'s site extractors may fetch third-party APIs;
 * - Defuddle falls back to the whole cleaned <body> on non-article pages — a
 *   char threshold decides "no content" (SPA shells, challenge pages, landing
 *   pages).
 */

import Defuddle from 'defuddle/full';
import { parseHTML } from 'linkedom';

export {
  classifyUrl,
  decodeHtmlBytes,
  fetchBookmarkPage,
  MAX_HTML_BYTES,
  type FetchFn,
  type FetchPageResult,
} from './bookmark-page-fetch';

/** Minimum trimmed Markdown length to count as real content. */
export const MIN_CONTENT_CHARS = 200;

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

/**
 * Threshold guard — "extraction found nothing" is the caller's judgement.
 * Exported pure for unit tests.
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
 * (SPA shell, challenge page, near-empty body). `url` is mandatory because the
 * inert document deliberately has no browsing-context base URL.
 */
export function extractMarkdown(html: string, url: string): { markdown: string } | null {
  // Third-party HTML must never enter the extension page's DOM implementation.
  // linkedom is inert: it has no browser resource loader, so preload/script/media
  // elements cannot affect app.html regardless of their spelling or nesting.
  const { document: doc } = parseHTML(html, {
    // Never let linkedom's defaultView proxy fall through to the branded host
    // Window method. An inert document has no layout or computed styles.
    getComputedStyle: () => ({}),
  });
  removeMalformedSchemaOrgScripts(doc);
  // Sync parse() only — parseAsync's extractors may call third-party APIs.
  const result = new Defuddle(doc, { url, markdown: true }).parse();
  const markdown = (result.content ?? '').trim();
  return meetsContentThreshold(markdown) ? { markdown } : null;
}
