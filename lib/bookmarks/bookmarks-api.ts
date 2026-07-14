/**
 * Browser bookmarks "API" layer — reads the LOCAL chrome.bookmarks tree and
 * normalizes it into flat folder / bookmark lists. Mirrors the role of
 * lib/github/github-api.ts and lib/bilibili/bilibili-api.ts (URL/data
 * normalization, no DB imports, no UI copy), with one structural difference:
 * bookmarks are local data, so there is NO remote credential and therefore NO
 * auth / rate-limit error classes. The only failure mode is the browser API
 * itself, which propagates as a plain Error.
 *
 * The tree traversal + URL normalization are pure and exported for unit tests;
 * `readBookmarkTree()` is the only function that touches `browser.bookmarks`.
 */

import { browser } from 'wxt/browser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal shape of a chrome.bookmarks tree node (structural — avoids coupling
 *  tests to the webextension-polyfill types). A node is a folder iff it has
 *  `children` and no `url`; a bookmark iff it has a `url`. */
export interface RawBookmarkNode {
  id: string;
  title: string;
  url?: string;
  dateAdded?: number;
  children?: RawBookmarkNode[];
}

/** A bookmark folder → becomes one `sources` row = one chip. */
export interface BookmarkFolder {
  /** chrome bookmark folder node id — stable within a browser profile. */
  id: string;
  title: string;
  /** Full path from the top-level container, e.g. "Bookmarks Bar/Tech/Web". */
  path: string;
}

/** A single bookmark → becomes one `items` row (deduped by normalizedUrl). */
export interface BookmarkEntry {
  /** Normalized URL — the stable dedup key (items.platformItemId). */
  normalizedUrl: string;
  /** Original URL as stored by the browser (items.originalUrl). */
  url: string;
  title: string;
  /** Registrable host (www-stripped), e.g. "github.com" — author grouping. */
  domain: string;
  /** ms epoch when the bookmark was added (chrome dateAdded); 0 if absent. */
  dateAdded: number;
  /** id of the IMMEDIATE parent folder (links the bookmark to its source). */
  folderId: string;
}

export interface BookmarkTree {
  folders: BookmarkFolder[];
  bookmarks: BookmarkEntry[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

const TRACKING_PARAMS = new Set(['ref', 'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid']);

/** True for http(s) URLs only — filters out javascript:, chrome://, file://,
 *  place:, data:, etc. that cannot be fetched/rendered as content. */
export function isHttpUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Canonicalize a URL for dedup (hamehome pattern): lowercase host, strip
 * `utm_*` + common click-tracking params, drop a trailing slash on non-root
 * paths. Deterministic — the SOLE dedup key for bookmark items. Falls back to
 * the trimmed raw string if the URL is unparseable.
 */
export function normalizeUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl.trim();
  }

  url.hostname = url.hostname.toLowerCase();

  for (const key of [...url.searchParams.keys()]) {
    const k = key.toLowerCase();
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) {
      url.searchParams.delete(key);
    }
  }

  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }

  return url.toString();
}

/** Registrable host with a leading `www.` stripped; '' if unparseable. */
export function extractDomain(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

/**
 * Flatten the chrome bookmark forest into flat folder + bookmark lists.
 * The synthetic root node(s) (id '0', empty title) are skipped as folders but
 * recursed into, so the top-level containers (Bookmarks Bar, Other Bookmarks)
 * become real folders. Non-http(s) bookmarks are dropped. Each bookmark carries
 * its IMMEDIATE parent folder id. Pure — exported for unit tests.
 */
export function flattenBookmarkTree(roots: RawBookmarkNode[]): BookmarkTree {
  const folders: BookmarkFolder[] = [];
  const bookmarks: BookmarkEntry[] = [];

  const isFolder = (node: RawBookmarkNode): boolean =>
    node.url === undefined && Array.isArray(node.children);

  const walk = (node: RawBookmarkNode, parentFolderId: string, parentPath: string): void => {
    if (isFolder(node)) {
      const path = parentPath ? `${parentPath}/${node.title}` : node.title;
      folders.push({ id: node.id, title: node.title, path });
      for (const child of node.children ?? []) walk(child, node.id, path);
      return;
    }
    if (node.url && isHttpUrl(node.url)) {
      bookmarks.push({
        normalizedUrl: normalizeUrl(node.url),
        url: node.url,
        title: node.title || node.url,
        domain: extractDomain(node.url),
        dateAdded: node.dateAdded ?? 0,
        folderId: parentFolderId,
      });
    }
  };

  // Roots are the synthetic '0' container(s); their children are top folders.
  for (const root of roots) {
    for (const child of root.children ?? []) walk(child, root.id, '');
  }

  return { folders, bookmarks };
}

// ---------------------------------------------------------------------------
// Browser API (the only impure entry point)
// ---------------------------------------------------------------------------

/** Read + flatten the whole local bookmark tree. Requires the `bookmarks`
 *  permission. Throws a plain Error if the browser API is unavailable. */
export async function readBookmarkTree(): Promise<BookmarkTree> {
  const roots = await browser.bookmarks.getTree();
  return flattenBookmarkTree(roots as RawBookmarkNode[]);
}
