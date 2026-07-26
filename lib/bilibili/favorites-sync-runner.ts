import type { BiliFavFolder, BiliFavVideo } from './types';
import type { CooperativeCheckpoint } from '@/lib/collections';

const PAGE_DELAY_MIN_MS = 7_000;
const PAGE_DELAY_JITTER_MS = 3_000;

export function favoritePageDelayMs(random: () => number = Math.random): number {
  return PAGE_DELAY_MIN_MS + random() * PAGE_DELAY_JITTER_MS;
}

export interface FavoriteVideosPage {
  videos: BiliFavVideo[];
  totalPages: number;
  hasMore: boolean;
}

export interface FavoriteVideosSyncBaseline {
  existingBvids: ReadonlySet<string>;
  historyComplete: boolean;
}

export interface BiliFavoritesSyncProgress {
  fetchedCount: number;
  folderIndex: number;
  folderCount: number;
  folderTitle: string;
  page: number;
  totalPages: number;
}

export interface FavoriteVideosSyncDeps {
  getBaseline(folder: BiliFavFolder): Promise<FavoriteVideosSyncBaseline>;
  fetchPage(folder: BiliFavFolder, page: number): Promise<FavoriteVideosPage>;
  persist(folder: BiliFavFolder, videos: BiliFavVideo[]): Promise<void>;
  markHistoryComplete(folder: BiliFavFolder): Promise<void>;
  waitBetweenPages(): Promise<void>;
}

export interface FavoriteVideosSyncResult {
  fetchedCount: number;
  syncedCount: number;
}

export type BiliFavoritesSyncProgressCallback = (
  progress: BiliFavoritesSyncProgress,
) => void;

export async function runFavoriteVideosSync(
  folders: BiliFavFolder[],
  deps: FavoriteVideosSyncDeps,
  onProgress?: BiliFavoritesSyncProgressCallback,
  control?: CooperativeCheckpoint,
): Promise<FavoriteVideosSyncResult> {
  let fetchedCount = 0;
  let syncedCount = 0;

  for (let folderIndex = 0; folderIndex < folders.length; folderIndex += 1) {
    await control?.checkpoint();
    const folder = folders[folderIndex];
    const baseline = await deps.getBaseline(folder);
    const existingBvids = baseline.historyComplete
      ? new Set([...baseline.existingBvids].map((bvid) => bvid.toLowerCase()))
      : null;
    const pending: BiliFavVideo[] = [];
    let page = 1;

    while (true) {
      await control?.checkpoint();
      if (page > 1) await deps.waitBetweenPages();

      const result = await deps.fetchPage(folder, page);
      fetchedCount += result.videos.length;
      const existingIndex = existingBvids
        ? result.videos.findIndex(
            (video) => Boolean(video.bvid) && existingBvids.has(video.bvid.toLowerCase()),
          )
        : -1;
      pending.push(...(existingIndex >= 0 ? result.videos.slice(0, existingIndex) : result.videos));
      onProgress?.({
        fetchedCount,
        folderIndex: folderIndex + 1,
        folderCount: folders.length,
        folderTitle: folder.title,
        page,
        totalPages: result.totalPages,
      });

      if (
        existingIndex >= 0
        || result.videos.length === 0
        || !result.hasMore
        || page >= result.totalPages
      ) break;
      page += 1;
    }

    if (pending.length > 0) await deps.persist(folder, pending);
    await deps.markHistoryComplete(folder);
    syncedCount += pending.length;
  }

  return { fetchedCount, syncedCount };
}
