export const BILIBILI_API = {
  pageList: (bvid: string) =>
    `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`,
  playerV2: (bvid: string, cid: number) =>
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`,
  playUrl: (bvid: string, cid: number) =>
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}&fnval=16&platform=html5`,
} as const;

const SUBTITLE_CDN_PATTERNS = [
  /\/bfs\/(ai_)?subtitle\//i,
  /\/aisubtitle\//i,
] as const;

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
