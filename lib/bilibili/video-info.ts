import { BILIBILI_API } from './api';

export function extractBvid(url: string): string | null {
  const match = url.match(/\/video\/(BV[\w]+)/);
  return match?.[1] ?? null;
}

export function extractPageNum(url: string): number {
  const match = url.match(/[?&]p=(\d+)/);
  return match ? Number(match[1]) : 1;
}

export async function fetchCidByPageList(bvid: string, pageNum: number = 1): Promise<number> {
  const url = BILIBILI_API.pageList(bvid);
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Pagelist API HTTP ${res.status}`);
  const json = await res.json();
  const pages: { cid: number; page: number }[] = json?.data ?? [];
  if (!pages.length) throw new Error(`No pages for ${bvid}`);
  const page = pages[pageNum - 1] ?? pages[0];
  return page.cid;
}
