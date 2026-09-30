/**
 * Platform Sync Record reads and writes (docs/32 §5.1): one state row per
 * Collection Platform in `platform_sync_records`. The app-side Platform Sync
 * funnel (entrypoints/app/hooks/platform-sync.ts) is the only writer; the
 * daily automatic trigger reads the latest attempt, the pages' "last synced"
 * reads the latest success (via `getPlatformLastSyncedAt`).
 *
 * Argument order: the read takes `db` last, like `getPlatformLastSyncedAt`
 * next door; the writes take it first, like the lib/ingest write operations.
 * An attempt opens the row, so success/failure are plain UPDATEs of it.
 *
 * Takes `db` explicitly and imports only the entity leaf + drizzle — never
 * `getDb()` or the '@/lib/database' barrel's values — so it stays loadable in
 * offscreen documents, matching collection-queries.ts.
 */

import { eq } from 'drizzle-orm';
import type { CollectionPlatform } from '@/lib/collections/platforms';
import type { FavbaseDb } from '@/lib/database';
import {
  platformSyncRecords,
  type PlatformSyncRecordRow,
} from '@/lib/database/entities/platform-sync-records';

export type PlatformSyncRecord = PlatformSyncRecordRow;

/** The counts a successful Platform Sync reports alongside its finish time. */
export interface PlatformSyncSuccess {
  at: Date;
  fetched: number;
  inserted: number;
}

/** The platform's record, or null when it has never attempted a Platform Sync. */
export async function getPlatformSyncRecord(
  platform: CollectionPlatform,
  db: FavbaseDb,
): Promise<PlatformSyncRecord | null> {
  const rows = await db
    .select()
    .from(platformSyncRecords)
    .where(eq(platformSyncRecords.platform, platform));
  return rows[0] ?? null;
}

/**
 * A Platform Sync is about to contact the platform: stamp the attempt and
 * clear the result (NULL = not finished). The latest success and its counts
 * are left alone.
 */
export async function recordPlatformSyncAttempt(
  db: FavbaseDb,
  platform: CollectionPlatform,
  at: Date,
): Promise<void> {
  await db
    .insert(platformSyncRecords)
    .values({ platform, lastAttemptAt: at })
    .onConflictDoUpdate({
      target: platformSyncRecords.platform,
      set: { lastAttemptAt: at, lastResult: null },
    });
}

/** The attempt finished successfully — the only write that moves "last synced". */
export async function recordPlatformSyncSuccess(
  db: FavbaseDb,
  platform: CollectionPlatform,
  { at, fetched, inserted }: PlatformSyncSuccess,
): Promise<void> {
  await db
    .update(platformSyncRecords)
    .set({ lastResult: 'success', lastSuccessAt: at, lastFetched: fetched, lastInserted: inserted })
    .where(eq(platformSyncRecords.platform, platform));
}

/** The attempt failed: the latest success and its counts stay as they were. */
export async function recordPlatformSyncFailure(
  db: FavbaseDb,
  platform: CollectionPlatform,
): Promise<void> {
  await db
    .update(platformSyncRecords)
    .set({ lastResult: 'failure' })
    .where(eq(platformSyncRecords.platform, platform));
}
