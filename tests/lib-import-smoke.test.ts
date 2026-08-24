/**
 * Lib import-smoke contract (docs/20 HIGH-1, revised to MEDIUM).
 *
 * Loading a lib-layer module must not require runtime capabilities the module
 * never asked for. The concrete leak this guards: `@/lib/embedding` (barrel)
 * value-re-exports `./config` → `@/lib/storage` → `settings.ts`, whose
 * module-level `storage.defineItem` touches `chrome.runtime` at load time.
 * Under vitest (happy-dom, no `chrome` global) that surfaces as asynchronous
 * unhandled rejections — not a synchronous throw — so a plain `import()`
 * "succeeding" proves nothing. This test captures `unhandledRejection` around
 * each import and asserts none fired.
 *
 * Rules this contract replaces (previously held by comments + defensive
 * `vi.mock('@/lib/storage')` in pure decoder tests):
 *   - Agent Bridge protocol and tool registry load without Chrome; Chat's
 *     `listTags` loads the tagging facade only when the tool executes.
 *   - lib-layer platform sync-services import `@/lib/embedding/<leaf>`, never
 *     the `@/lib/embedding` barrel, and never `@/lib/storage`/`@/lib/tagging`.
 *   - the shared ingest pipeline, database entry, chunkers and the platform
 *     discriminator list stay storage-free.
 *   - the Bilibili transcription seam (`transcribe-utils`) never value-imports
 *     `@/lib/embedding`/`@/lib/tagging`; post-processing is injected via
 *     `startProcessing` (docs/20 中-5).
 *
 * No `vi.mock` anywhere in this file — that is the point. Each entry is
 * imported after `vi.resetModules()` so a leak is attributed to the entry
 * that triggered it rather than hidden by an earlier entry having already
 * evaluated `@/lib/storage`.
 *
 * Platform N+1 is enrolled automatically: sync-service paths derive from
 * `COLLECTION_PLATFORMS`, discovered as the single `*-sync-service.ts` in
 * `lib/<platform>/`.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { COLLECTION_PLATFORMS } from '@/lib/collections/platforms';

const ROOT = path.resolve(__dirname, '..');

function platformSyncServiceModule(platform: string): string {
  const dir = `lib/${platform}`;
  const candidates = readdirSync(path.join(ROOT, dir)).filter(
    (name) => name.endsWith('-sync-service.ts') && !name.endsWith('.test.ts'),
  );
  expect(candidates, `${dir} must contain exactly one *-sync-service.ts`).toHaveLength(1);
  return `@/${dir}/${candidates[0]!.replace(/\.ts$/, '')}`;
}

const PURE_ENTRIES: readonly string[] = [
  '@/lib/agent-bridge/protocol',
  '@/lib/agent-bridge/tool-registry',
  '@/lib/bilibili/transcribe-utils',
  '@/lib/embedding/chunker',
  '@/lib/embedding/char-split',
  '@/lib/collections/platforms',
  '@/lib/ingest/ingest',
  '@/lib/database',
];

const rejections: unknown[] = [];
const onUnhandledRejection = (reason: unknown): void => {
  rejections.push(reason);
};

/** Let the microtask + macrotask queues drain so load-time rejections land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
}

async function importClean(specifier: string): Promise<void> {
  rejections.length = 0;
  vi.resetModules();
  await import(/* @vite-ignore */ specifier);
  await settle();
  const messages = rejections.map((reason) =>
    reason instanceof Error ? reason.message : String(reason),
  );
  expect(messages, `${specifier} leaked runtime capability at load time`).toEqual([]);
}

describe('lib import-smoke contract (no chrome global, no mocks)', () => {
  beforeAll(() => {
    expect(typeof (globalThis as { chrome?: unknown }).chrome).toBe('undefined');
    process.on('unhandledRejection', onUnhandledRejection);
  });

  afterAll(() => {
    process.off('unhandledRejection', onUnhandledRejection);
  });

  it.each([...COLLECTION_PLATFORMS])(
    'lib/%s sync-service loads without touching chrome.runtime',
    async (platform) => {
      await importClean(platformSyncServiceModule(platform));
    },
  );

  it.each(PURE_ENTRIES)('%s loads without touching chrome.runtime', async (specifier) => {
    await importClean(specifier);
  });
});
