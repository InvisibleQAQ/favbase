import type { PGlite } from '@electric-sql/pglite';

/**
 * v7: platform_sync_records — the Platform Sync Record (docs/32 §5.1, D1).
 *
 * One upserted state row per Collection Platform: the latest attempt
 * (`last_attempt_at`, `last_result` reset to NULL when it starts, so NULL =
 * not finished) and the latest success with that run's counts. "Last synced"
 * and the daily automatic trigger read it instead of `max(sources.last_fetched_at)`,
 * which a failed or empty sync never moved (docs/32 high-1).
 *
 * The CHECK is named in SQL with the same name as the entity's `check()`
 * (lib/database/migrations/CLAUDE.md). No CHECK on `platform`: onboarding a
 * platform must not need a migration. `IF NOT EXISTS` keeps this idempotent
 * under the `_migrations`-tracked runner.
 */
export async function up(pg: PGlite): Promise<void> {
  await pg.exec(`
    CREATE TABLE IF NOT EXISTS platform_sync_records (
      platform        TEXT PRIMARY KEY,
      last_attempt_at TIMESTAMPTZ NOT NULL,
      last_result     TEXT
        CONSTRAINT chk_platform_sync_result CHECK (last_result IN ('success','failure')),
      last_success_at TIMESTAMPTZ,
      last_fetched    INTEGER,
      last_inserted   INTEGER
    );
  `);
}
