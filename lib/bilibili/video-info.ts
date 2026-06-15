import type { VideoInfo } from '../types';

/**
 * Extract BV number from a bilibili video URL.
 *
 * Supports:
 *   https://www.bilibili.com/video/BVxxxxxx
 *   https://www.bilibili.com/video/BVxxxxxx?p=2
 */
export function extractBvid(url: string): string | null {
  const match = url.match(/\/video\/(BV[\w]+)/);
  return match?.[1] ?? null;
}

/**
 * Extract page number (?p=N) from URL. Returns 1-based index, defaults to 1.
 */
export function extractPageNum(url: string): number {
  const match = url.match(/[?&]p=(\d+)/);
  return match ? Number(match[1]) : 1;
}

/**
 * Fetch video info (title, CID list) from bilibili web API.
 * Must be called from the same origin (bilibili.com) so cookies are included.
 */
export async function fetchVideoInfo(bvid: string): Promise<VideoInfo> {
  const url = `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`;
  const res = await fetch(url, { credentials: 'include' });

  if (!res.ok) {
    throw new Error(`Failed to fetch video info: HTTP ${res.status}`);
  }

  const json = await res.json();
  const data = json?.data;

  if (!data) {
    throw new Error(`Invalid video info response for ${bvid}`);
  }

  return {
    bvid: data.bvid ?? bvid,
    title: data.title ?? '',
    pages: (data.pages ?? []).map(
      (p: { cid: number; page: number; part: string }) => ({
        cid: p.cid,
        page: p.page,
        part: p.part,
      }),
    ),
  };
}

/**
 * Get the CID for a specific page number (1-based).
 * Falls back to the first page if pageNum is out of range.
 */
export function getCidForPage(info: VideoInfo, pageNum: number): number {
  const page = info.pages[pageNum - 1] ?? info.pages[0];
  if (!page) {
    throw new Error(`No pages found for video ${info.bvid}`);
  }
  return page.cid;
}

/**
 * Lightweight CID resolution via /x/player/pagelist.
 * Simpler than fetchVideoInfo and less likely to require WBI signature.
 */
export async function fetchCidByPageList(bvid: string, pageNum: number = 1): Promise<number> {
  const url = `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`;
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Pagelist API HTTP ${res.status}`);
  const json = await res.json();
  const pages: { cid: number; page: number }[] = json?.data ?? [];
  if (!pages.length) throw new Error(`No pages for ${bvid}`);
  const page = pages[pageNum - 1] ?? pages[0];
  return page.cid;
}
