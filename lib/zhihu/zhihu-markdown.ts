/**
 * Zhihu HTML → Markdown conversion (turndown), tuned for zhihu's rich-text
 * quirks (mirrors RSSHub's processImage cleanup, research/zhihu-api.md §3.2):
 *   - `<noscript>` duplicates of lazy-loaded images are dropped
 *   - lazy images read `data-actualsrc` / `data-original` before `src`, with
 *     zhihu's size suffix (`_720w.jpg` → `.jpg`) stripped; data-URI
 *     placeholders yield nothing
 *   - `link.zhihu.com/?target=…` redirect wrappers unwrap to the real URL
 *   - formula images (`eeimg`) fall back to their `alt` LaTeX text via the
 *     shared img rule
 *
 * Turndown needs a DOM: in extension pages (app.html — where zhihu sync runs)
 * it uses the real document; under Node/vitest it falls back to its bundled
 * domino parser. Do NOT put this module on a background-SW execution path.
 *
 * A conversion failure never fails a sync — it degrades to stripped plain text.
 */

import TurndownService from 'turndown';
import { stripHtmlToText, stripImageSizeSuffix } from './zhihu-api';

let service: TurndownService | null = null;

/** Unwrap zhihu's external-link redirect: `link.zhihu.com/?target=<enc>` → real URL. */
export function unwrapZhihuRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (u.hostname === 'link.zhihu.com') {
      const target = u.searchParams.get('target');
      if (target) return target;
    }
  } catch {
    // relative / invalid href — keep as-is
  }
  return href;
}

function getService(): TurndownService {
  if (service) return service;

  const s = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });

  // Lazy-load duplicates — the real <img> carries the content.
  s.remove('noscript');

  // Zhihu lazy images: real URL sits in data-actualsrc / data-original; `src`
  // is often a data-URI placeholder. Formula images carry LaTeX in `alt`.
  s.addRule('zhihuImage', {
    filter: 'img',
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src =
        el.getAttribute('data-actualsrc') ||
        el.getAttribute('data-original') ||
        el.getAttribute('src') ||
        '';
      const alt = (el.getAttribute('alt') ?? '').replace(/\n/g, ' ');
      if (!src || src.startsWith('data:')) return alt ? alt : '';
      return `![${alt}](${stripImageSizeSuffix(src)})`;
    },
  });

  // Anchors: unwrap the link.zhihu.com redirect so the markdown carries the
  // real destination.
  s.addRule('zhihuLink', {
    filter: (node) => node.nodeName === 'A' && !!(node as HTMLElement).getAttribute('href'),
    replacement: (content, node) => {
      const href = unwrapZhihuRedirect((node as HTMLElement).getAttribute('href') ?? '');
      const text = content.trim() || href;
      return href ? `[${text}](${href})` : text;
    },
  });

  service = s;
  return s;
}

/**
 * Convert a zhihu HTML fragment to Markdown. Empty input → ''. A turndown
 * failure degrades to stripped plain text (one bad document must never abort
 * a whole sync).
 */
export function htmlToMarkdown(html: string): string {
  const trimmed = html?.trim();
  if (!trimmed) return '';
  try {
    return getService().turndown(trimmed).trim();
  } catch (err) {
    console.error('[zhihu] turndown conversion failed, falling back to plain text:', err);
    return stripHtmlToText(trimmed);
  }
}
