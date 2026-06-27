/**
 * Pure URL utilities for bilibili — zero chrome.* dependencies.
 * Safe for Main World (bilibili-inject) and all other contexts.
 */

const SUBTITLE_CDN_PATTERNS = [
  /\/bfs\/(ai_)?subtitle\//i,
  /\/aisubtitle\//i,
] as const;

/** Extract BV ID from a bilibili video URL, preserving original case. */
export function extractBvid(url: string): string | null {
  const match = url.match(/\/video\/(BV[\w]+)/i);
  return match?.[1] ?? null;
}

/** Extract page number (?p=N) from a bilibili URL. Defaults to 1. */
export function extractPageNum(url: string): number {
  const match = url.match(/[?&]p=(\d+)/);
  return match ? Number(match[1]) : 1;
}

/** Normalize a bilibili cover URL (protocol-relative → https). */
export function normalizeCover(cover?: string): string {
  if (!cover) return '';
  return cover.startsWith('//') ? `https:${cover}` : cover;
}

/** Check if a URL points to bilibili's subtitle CDN. */
export function isSubtitleCdnUrl(url: string): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url, location.href);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host === 'data.bilibili.com') return false;
  if (path.includes('/log/web')) return false;
  if (SUBTITLE_CDN_PATTERNS.some((re) => re.test(path))) return true;
  if (path.endsWith('.json') && path.includes('subtitle')) return true;
  return false;
}
