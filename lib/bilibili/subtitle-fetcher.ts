import type { SubtitleResult, SubtitleRow } from '../types';

interface SubtitleTrack {
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

/**
 * Fetch bilibili AI subtitles for a video.
 *
 * Steps:
 * 1. Call /x/player/v2 to get subtitle track list
 * 2. Pick the Chinese track (or first available)
 * 3. Fetch the subtitle JSON from CDN
 * 4. Parse body[] into SubtitleRow[]
 *
 * Runs in content script (same-origin with api.bilibili.com, cookies auto-included).
 */
export async function fetchBilibiliSubtitle(
  bvid: string,
  cid: number,
): Promise<SubtitleResult> {
  // Step 1: Get subtitle track list from player API
  const playerUrl = `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(String(cid))}`;
  const playerRes = await fetch(playerUrl, { credentials: 'include' });

  if (!playerRes.ok) {
    return { status: 'error', rows: [], error: `Player API HTTP ${playerRes.status}` };
  }

  const playerData = await playerRes.json();
  const subtitles: SubtitleTrack[] | undefined = playerData?.data?.subtitle?.subtitles;

  if (!subtitles?.length) {
    return { status: 'no_subtitle', rows: [] };
  }

  // Step 2: Pick Chinese subtitle track, fallback to first
  const zhTrack = subtitles.find((s) => s.lan_doc.includes('中文')) ?? subtitles[0];
  const rawUrl = zhTrack.subtitle_url?.trim();

  if (!rawUrl) {
    return { status: 'no_subtitle', rows: [] };
  }

  // Step 3: Fetch subtitle JSON (CDN URL needs https: prefix)
  const subtitleUrl = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
  const subRes = await fetch(subtitleUrl, { credentials: 'include' });

  if (!subRes.ok) {
    return { status: 'error', rows: [], error: `Subtitle CDN HTTP ${subRes.status}` };
  }

  const subData = await subRes.json();

  // Step 4: Parse body array — handle multiple possible response shapes
  const body: unknown[] =
    subData?.body ?? subData?.data?.body ?? subData?.content ?? subData?.result?.body ?? (Array.isArray(subData) ? subData : []);

  if (!Array.isArray(body) || body.length === 0) {
    return { status: 'no_subtitle', rows: [] };
  }

  const rows: SubtitleRow[] = body.map(
    (item: unknown) => {
      const entry = item as { from: number; to: number; content: string };
      return {
        start: entry.from,
        end: entry.to,
        text: entry.content,
      };
    },
  );

  return { status: 'ok', rows, source: 'bilibili' };
}
