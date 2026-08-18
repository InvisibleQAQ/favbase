import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardrail (platform-constants survey 2026-08-18, final plan v3): every
 * numeric SCALAR policy constant in a platform directory must be
 * env-configurable through `envNumber(key, fallback)` (lib/env.ts) and
 * documented in the platform blocks of `.env.example` / `.env.local`. A bare
 * module-level `const FOO_MS = 1000;` in lib/{platform}/ fails this test —
 * future platforms inherit the contract by construction (same mechanism as
 * tests/http-fetch-deadline-guard.test.ts).
 *
 * Three locks:
 * 1. No bare numeric SCREAMING_CASE module constants in platform dirs
 *    (allowlist below, with a reason; stale entries fail).
 * 2. EXPECTED_ENV_CONSTANTS pins each call site's fallback to the
 *    pre-migration value — behavior with an empty env is provably unchanged,
 *    and a silently edited default fails here.
 * 3. Call sites ↔ EXPECTED table ↔ `.env.example` docs stay in sync both
 *    ways (the env files are gitignored, so the docs check runs only where
 *    they exist — this table is the tracked source of truth).
 *
 * Deliberately NOT env-configurable (identity/contract constants): API
 * URLs/endpoints, X BOOKMARKS_QUERY_ID, protocol channel/version, storage
 * keys, regexes, prompts, array constants (SUBTITLE_RETRY_DELAYS — starts
 * with `[`, never matches the scalar pattern).
 */

const ROOT = path.resolve(__dirname, '..');

const PLATFORM_DIRS = [
  'lib/bilibili',
  'lib/github',
  'lib/x',
  'lib/zhihu',
  'lib/youtube',
  'lib/bookmarks',
];

/** Files allowed to keep bare numeric module constants, with the reason WHY. */
const ALLOWED_BARE_NUMERIC: Record<string, string> = {
  'lib/bilibili/messaging.ts':
    'cross-runtime protocol contract (BILI_PROTOCOL_VERSION + payload caps shared by sender/receiver schemas) — an env override would desync the two ends',
};

/**
 * Behavior lock: fallback values are the exact pre-migration constants
 * (docs/tmp_platform-constants-survey.md A/B/C lists + the two
 * github-sync-service scalars found in the implementation sweep).
 */
const EXPECTED_ENV_CONSTANTS: ReadonlyArray<{
  file: string;
  key: string;
  fallback: number;
}> = [
  // github
  { file: 'lib/github/github-api.ts', key: 'VITE_GITHUB_PER_PAGE', fallback: 100 },
  { file: 'lib/github/github-api.ts', key: 'VITE_GITHUB_PAGE_DELAY_MS', fallback: 100 },
  { file: 'lib/github/github-sync-service.ts', key: 'VITE_GITHUB_README_DELAY_MS', fallback: 100 },
  { file: 'lib/github/github-sync-service.ts', key: 'VITE_GITHUB_MAX_README_CHARS', fallback: 100_000 },
  // youtube
  { file: 'lib/youtube/youtube-api.ts', key: 'VITE_YOUTUBE_PAGE_SIZE', fallback: 50 },
  { file: 'lib/youtube/youtube-api.ts', key: 'VITE_YOUTUBE_PAGE_DELAY_MS', fallback: 200 },
  { file: 'lib/youtube/youtube-sync-service.ts', key: 'VITE_YOUTUBE_META_DESCRIPTION_MAX_CHARS', fallback: 500 },
  // x
  { file: 'lib/x/x-api.ts', key: 'VITE_X_PAGE_SIZE', fallback: 100 },
  { file: 'lib/x/x-api.ts', key: 'VITE_X_BASE_DELAY_MS', fallback: 1000 },
  { file: 'lib/x/x-api.ts', key: 'VITE_X_JITTER_MS', fallback: 500 },
  { file: 'lib/x/x-api.ts', key: 'VITE_X_REMAINING_STOP_THRESHOLD', fallback: 3 },
  { file: 'lib/x/x-api.ts', key: 'VITE_X_MAX_RETRIES', fallback: 5 },
  { file: 'lib/x/x-api.ts', key: 'VITE_X_BACKOFF_BASE_MS', fallback: 1000 },
  { file: 'lib/x/x-api.ts', key: 'VITE_X_MIN_SLEEP_ON_RESET_MS', fallback: 1000 },
  { file: 'lib/x/x-sync-service.ts', key: 'VITE_X_TITLE_MAX_CHARS', fallback: 140 },
  // zhihu
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_ITEMS_PAGE_SIZE', fallback: 20 },
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_BASE_DELAY_MS', fallback: 1000 },
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_JITTER_MS', fallback: 500 },
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_MAX_RETRIES', fallback: 5 },
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_BACKOFF_BASE_MS', fallback: 1000 },
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_MAX_COLLECTION_PAGES', fallback: 50 },
  { file: 'lib/zhihu/zhihu-api.ts', key: 'VITE_ZHIHU_MAX_ITEM_PAGES_PER_COLLECTION', fallback: 500 },
  // bilibili
  { file: 'lib/bilibili/favorites-sync-runner.ts', key: 'VITE_BILIBILI_PAGE_DELAY_MIN_MS', fallback: 7_000 },
  { file: 'lib/bilibili/favorites-sync-runner.ts', key: 'VITE_BILIBILI_PAGE_DELAY_JITTER_MS', fallback: 3_000 },
  { file: 'lib/bilibili/bili-sync-service.ts', key: 'VITE_BILIBILI_PAGE_SIZE', fallback: 20 },
  // bookmarks
  { file: 'lib/bookmarks/bookmark-content-service.ts', key: 'VITE_BOOKMARKS_BATCH_SIZE', fallback: 50 },
  { file: 'lib/bookmarks/bookmark-content-service.ts', key: 'VITE_BOOKMARKS_DEFAULT_DELAY_MS', fallback: 1000 },
  { file: 'lib/bookmarks/bookmark-page-fetch.ts', key: 'VITE_BOOKMARKS_MAX_HTML_BYTES', fallback: 5_242_880 },
  { file: 'lib/bookmarks/bookmark-page-fetch.ts', key: 'VITE_BOOKMARKS_META_PRESCAN_BYTES', fallback: 1024 },
  { file: 'lib/bookmarks/bookmark-content.ts', key: 'VITE_BOOKMARKS_MIN_CONTENT_CHARS', fallback: 200 },
];

/** Module-level `const NAME = <number-ish literal/arith>` (arrays/strings/objects never match). */
const BARE_NUMERIC_CONST =
  /^(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=\s*-?[\d][\d_.]*(?:\s*[*+/-]\s*-?[\d][\d_.]*)*\s*;/;

const ENV_NUMBER_CALL = /envNumber\(\s*'([A-Z0-9_]+)'\s*,\s*(-?[\d_.]+)\s*\)/g;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Remove block comments while preserving newline count so line numbers stay accurate. */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function stripLineComment(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

function bareNumericLines(file: string): number[] {
  const cleaned = stripBlockComments(readFileSync(file, 'utf8'));
  const hits: number[] = [];
  cleaned.split('\n').forEach((rawLine, i) => {
    if (BARE_NUMERIC_CONST.test(stripLineComment(rawLine))) hits.push(i + 1);
  });
  return hits;
}

function toRel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function platformFiles(): string[] {
  return PLATFORM_DIRS.flatMap((dir) => walkTs(path.join(ROOT, dir)));
}

function parseNum(raw: string): number {
  return Number(raw.replace(/_/g, ''));
}

describe('platform env constants guard', () => {
  it('has no bare numeric module constants in platform dirs (use envNumber)', () => {
    const offenders: string[] = [];
    for (const file of platformFiles()) {
      const rel = toRel(file);
      if (rel in ALLOWED_BARE_NUMERIC) continue;
      for (const line of bareNumericLines(file)) {
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(
      offenders,
      `Bare numeric constant found — make it env-configurable via envNumber ` +
        `(lib/env.ts), add it to EXPECTED_ENV_CONSTANTS and the .env docs, ` +
        `or allowlist the file with a reason:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWED_BARE_NUMERIC)) {
      const full = path.join(ROOT, rel);
      if (!existsSync(full) || bareNumericLines(full).length === 0) stale.push(rel);
    }
    expect(
      stale,
      `Allowlist entries without a bare numeric constant — remove them:\n${stale.join('\n')}`,
    ).toEqual([]);
  });

  it('locks every envNumber call site to its pre-migration fallback', () => {
    for (const { file, key, fallback } of EXPECTED_ENV_CONSTANTS) {
      const src = readFileSync(path.join(ROOT, file), 'utf8');
      const m = src.match(
        new RegExp(`envNumber\\(\\s*'${key}'\\s*,\\s*(-?[\\d_.]+)\\s*\\)`),
      );
      expect(m, `${file}: expected an envNumber('${key}', ${fallback}) call site`).toBeTruthy();
      expect(
        parseNum(m![1]),
        `${file}: fallback for ${key} drifted from the locked default ${fallback}`,
      ).toBe(fallback);
    }
  });

  it('has no envNumber key in platform dirs missing from the expected table', () => {
    const known = new Set(EXPECTED_ENV_CONSTANTS.map((e) => e.key));
    const unknown: string[] = [];
    for (const file of platformFiles()) {
      const src = stripBlockComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(ENV_NUMBER_CALL)) {
        if (!known.has(m[1])) unknown.push(`${toRel(file)}: ${m[1]}`);
      }
    }
    expect(
      unknown,
      `envNumber keys not registered in EXPECTED_ENV_CONSTANTS (register + document them):\n${unknown.join('\n')}`,
    ).toEqual([]);
  });

  // .env.example / .env.local are gitignored (they carry real keys), so the
  // docs check runs only where the file exists; the table above is the
  // tracked contract.
  for (const envFile of ['.env.example', '.env.local']) {
    it(`keeps ${envFile} platform blocks in sync with the expected table (when present)`, () => {
      const full = path.join(ROOT, envFile);
      if (!existsSync(full)) return;
      const content = readFileSync(full, 'utf8');

      const missing = EXPECTED_ENV_CONSTANTS.filter(
        ({ key }) => !content.includes(`# ${key}=`) && !content.includes(`${key}=`),
      ).map(({ key }) => key);
      expect(
        missing,
        `${envFile} is missing documented lines for:\n${missing.join('\n')}`,
      ).toEqual([]);

      const known = new Set(EXPECTED_ENV_CONSTANTS.map((e) => e.key));
      const platformKeyLine =
        /^#?\s*(VITE_(?:BILIBILI|GITHUB|X|ZHIHU|YOUTUBE|BOOKMARKS)_[A-Z0-9_]+)=/;
      const orphans: string[] = [];
      for (const line of content.split('\n')) {
        const m = line.match(platformKeyLine);
        if (m && !known.has(m[1])) orphans.push(m[1]);
      }
      expect(
        orphans,
        `${envFile} documents platform keys that no code reads:\n${orphans.join('\n')}`,
      ).toEqual([]);
    });
  }
});
