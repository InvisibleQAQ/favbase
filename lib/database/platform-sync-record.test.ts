import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@/lib/database/schema';
import { runMigrations } from '@/lib/database/migrations';
import type { FavbaseDb } from '@/lib/database';
import { getPlatformLastSyncedAt } from './collection-queries';
import {
  getPlatformSyncRecord,
  recordPlatformSyncAttempt,
  recordPlatformSyncFailure,
  recordPlatformSyncSuccess,
} from './platform-sync-record';

const T1 = new Date('2026-09-30T01:00:00Z');
const T2 = new Date('2026-09-30T02:00:00Z');
const T3 = new Date('2026-09-30T03:00:00Z');

describe('Platform Sync Record (v007)', () => {
  let pg: PGlite;
  let db: FavbaseDb;

  beforeAll(async () => {
    pg = await PGlite.create({ extensions: { vector, uuid_ossp, pg_trgm } });
    await runMigrations(pg);
    db = drizzle({ client: pg, schema }) as unknown as FavbaseDb;
  });

  beforeEach(async () => {
    await pg.exec('DELETE FROM platform_sync_records');
  });

  afterAll(async () => {
    await pg.close();
  });

  it('has no record and no "last synced" before the first attempt', async () => {
    await expect(getPlatformSyncRecord('github', db)).resolves.toBeNull();
    await expect(getPlatformLastSyncedAt('github', db)).resolves.toBeNull();
  });

  it('an attempt opens the row unfinished, with no success yet', async () => {
    await recordPlatformSyncAttempt(db, 'github', T1);

    await expect(getPlatformSyncRecord('github', db)).resolves.toEqual({
      platform: 'github',
      lastAttemptAt: T1,
      lastResult: null,
      lastSuccessAt: null,
      lastFetched: null,
      lastInserted: null,
    });
    await expect(getPlatformLastSyncedAt('github', db)).resolves.toBeNull();
  });

  it('a success records its time and counts, and becomes "last synced"', async () => {
    await recordPlatformSyncAttempt(db, 'github', T1);
    await recordPlatformSyncSuccess(db, 'github', { at: T2, fetched: 55, inserted: 3 });

    await expect(getPlatformSyncRecord('github', db)).resolves.toMatchObject({
      lastAttemptAt: T1,
      lastResult: 'success',
      lastSuccessAt: T2,
      lastFetched: 55,
      lastInserted: 3,
    });
    await expect(getPlatformLastSyncedAt('github', db)).resolves.toEqual(T2);
  });

  it('a new attempt moves only the attempt and clears the result', async () => {
    await recordPlatformSyncAttempt(db, 'github', T1);
    await recordPlatformSyncSuccess(db, 'github', { at: T1, fetched: 55, inserted: 3 });
    await recordPlatformSyncAttempt(db, 'github', T2);

    await expect(getPlatformSyncRecord('github', db)).resolves.toMatchObject({
      lastAttemptAt: T2,
      lastResult: null,
      lastSuccessAt: T1,
      lastFetched: 55,
      lastInserted: 3,
    });
  });

  it('a failure keeps the previous success and its counts', async () => {
    await recordPlatformSyncAttempt(db, 'github', T1);
    await recordPlatformSyncSuccess(db, 'github', { at: T1, fetched: 55, inserted: 3 });
    await recordPlatformSyncAttempt(db, 'github', T3);
    await recordPlatformSyncFailure(db, 'github');

    await expect(getPlatformSyncRecord('github', db)).resolves.toMatchObject({
      lastAttemptAt: T3,
      lastResult: 'failure',
      lastSuccessAt: T1,
      lastFetched: 55,
      lastInserted: 3,
    });
    await expect(getPlatformLastSyncedAt('github', db)).resolves.toEqual(T1);
  });

  it('only failures never produce a "last synced"', async () => {
    await recordPlatformSyncAttempt(db, 'zhihu', T1);
    await recordPlatformSyncFailure(db, 'zhihu');
    await recordPlatformSyncAttempt(db, 'zhihu', T2);
    await recordPlatformSyncFailure(db, 'zhihu');

    await expect(getPlatformSyncRecord('zhihu', db)).resolves.toMatchObject({
      lastAttemptAt: T2,
      lastResult: 'failure',
    });
    await expect(getPlatformLastSyncedAt('zhihu', db)).resolves.toBeNull();
  });

  it('rejects an unknown result through the named CHECK', async () => {
    await expect(
      pg.query(
        `INSERT INTO platform_sync_records (platform, last_attempt_at, last_result)
         VALUES ('x', NOW(), 'silent')`,
      ),
    ).rejects.toThrow(/chk_platform_sync_result/);
  });

  it('keeps each platform in its own row', async () => {
    await recordPlatformSyncAttempt(db, 'github', T1);
    await recordPlatformSyncSuccess(db, 'github', { at: T1, fetched: 1, inserted: 1 });
    await recordPlatformSyncAttempt(db, 'x', T2);
    await recordPlatformSyncFailure(db, 'x');

    await expect(getPlatformSyncRecord('github', db)).resolves.toMatchObject({
      lastResult: 'success',
      lastSuccessAt: T1,
    });
    await expect(getPlatformSyncRecord('x', db)).resolves.toMatchObject({
      lastResult: 'failure',
      lastSuccessAt: null,
    });
    await expect(getPlatformSyncRecord('youtube', db)).resolves.toBeNull();
  });

  it('the migration is idempotent', async () => {
    const { up } = await import('./migrations/v007-platform-sync-records');
    await expect(up(pg)).resolves.toBeUndefined();
    const { rows } = await pg.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname = 'chk_platform_sync_result'`,
    );
    expect(rows).toHaveLength(1);
  });
});
