import { pgTable, text, timestamp, integer, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { CollectionPlatform } from '@/lib/collections/platforms';

/**
 * Platform Sync Record (v007, docs/32 §5.1): one row per Collection Platform
 * holding this device's latest Platform Sync attempt and how it ended, plus
 * its latest successful Platform Sync with that run's counts. Three facts the
 * columns do not say:
 *
 * - It is a STATE row, upserted in place like `sources`, not an insert-only
 *   business table and not a history log — the ingest insert-only rule does
 *   not apply to it.
 * - It is a DEVICE-LOCAL fact. The WebDAV data sync (phase 2, lib/sync) must
 *   exclude this table: merged onto device B, device A's row would tell B it
 *   has already synced today and suppress B's own daily run.
 * - The only writer is the app-side Platform Sync funnel
 *   (entrypoints/app/hooks/platform-sync.ts), through
 *   lib/database/platform-sync-record.ts.
 *
 * The `CollectionPlatform` import is type-only (erased at compile time),
 * keeping this entity runtime-dependency free like its siblings. No CHECK on
 * `platform`: a new platform must never need a migration.
 */
export const platformSyncRecords = pgTable(
  'platform_sync_records',
  {
    /** Collection discriminator ('github'), never the job namespace ('github-stars'). */
    platform: text('platform').$type<CollectionPlatform>().primaryKey(),
    /** When the latest attempt started (a run is about to contact the platform). */
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }).notNull(),
    /** Reset to NULL when an attempt starts, so NULL means "not finished". */
    lastResult: text('last_result').$type<'success' | 'failure'>(),
    /** Latest successful completion; a failed attempt never moves it. */
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    /** Entries read from the platform by the run at `lastSuccessAt`. */
    lastFetched: integer('last_fetched'),
    /** Items newly inserted by the run at `lastSuccessAt` — the page's "N new". */
    lastInserted: integer('last_inserted'),
  },
  (t) => [check('chk_platform_sync_result', sql`${t.lastResult} IN ('success','failure')`)],
);

export type PlatformSyncRecordRow = typeof platformSyncRecords.$inferSelect;
export type NewPlatformSyncRecordRow = typeof platformSyncRecords.$inferInsert;
