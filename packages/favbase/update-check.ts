import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { favbaseHome, type ConfigEnv } from './config';
import { compareVersions, isReleaseVersion } from './version';

/**
 * Whether this CLI is the latest published release (docs/27 Step 2, L3).
 * Chrome updates the extension on its own; a global npm install never updates
 * itself, so "new extension + old CLI" is the steady state without this. The
 * CLI cannot fix it (upgrading is the user's action) -- it can only notice.
 */

export const UPDATE_CHECK_FILE_NAME = 'update-check.json';
export const UPDATE_CHECK_OPT_OUT = 'FAVBASE_NO_UPDATE_CHECK';
export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
export const UPDATE_CHECK_BUDGET_MS = 1_500;

/**
 * Both answer `GET /favbase/latest` with the published manifest. The mirror is
 * there because most users are in mainland China, where registry.npmjs.org
 * often cannot answer within the budget; asking both and taking the highest
 * means a lagging mirror can only make the answer late, never wrong.
 */
export const REGISTRY_LATEST_URLS = [
  'https://registry.npmjs.org/favbase/latest',
  'https://registry.npmmirror.com/favbase/latest',
] as const;

/** `daily` reads a 24-hour cache first; `always` (doctor) skips it; `none` never checks. */
export type UpdatePolicy = 'none' | 'daily' | 'always';

export interface CliCurrency {
  version: string;
  latest: string | null;
  state: 'current' | 'outdated' | 'unknown';
  /** Present only when `state` is `unknown`. */
  reason?: string;
}

interface UpdateCache {
  checkedAt: number;
  latest: string | null;
}

export function updateCheckPath(env: ConfigEnv): string {
  return join(favbaseHome(env), UPDATE_CHECK_FILE_NAME);
}

/** Any non-empty value other than `0` opts out. */
export function updateCheckDisabled(env: ConfigEnv): boolean {
  const value = env[UPDATE_CHECK_OPT_OUT]?.trim();
  return !!value && value !== '0';
}

/**
 * Queries both registries concurrently within one budget and returns the
 * highest release version any of them reported; `null` when none answered
 * usably. Never throws. `fetchImpl` is required so nothing reaches the network
 * by default: only cli.ts passes the real `fetch`.
 */
export async function queryRegistries(
  fetchImpl: typeof fetch,
  budgetMs: number = UPDATE_CHECK_BUDGET_MS,
): Promise<string | null> {
  const signal = AbortSignal.timeout(budgetMs);
  const answers = await Promise.allSettled(REGISTRY_LATEST_URLS.map(async (url) => {
    const response = await fetchImpl(url, { signal, headers: { accept: 'application/json' } });
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }
    const body = (await response.json()) as { version?: unknown } | null;
    return typeof body?.version === 'string' ? body.version : null;
  }));

  let highest: string | null = null;
  for (const answer of answers) {
    if (answer.status !== 'fulfilled' || answer.value === null) continue;
    if (!isReleaseVersion(answer.value)) continue;
    if (highest === null || compareVersions(answer.value, highest) === 1) highest = answer.value;
  }
  return highest;
}

async function readCache(path: string): Promise<UpdateCache | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as Partial<UpdateCache> | null;
    if (!value || typeof value !== 'object' || !Number.isFinite(value.checkedAt)) return null;
    if (typeof value.latest !== 'string' && value.latest !== null) return null;
    return { checkedAt: value.checkedAt as number, latest: value.latest };
  } catch {
    return null;
  }
}

async function writeCache(env: ConfigEnv, cache: UpdateCache): Promise<void> {
  try {
    await mkdir(favbaseHome(env), { recursive: true, mode: 0o700 });
    await writeFile(updateCheckPath(env), `${JSON.stringify(cache)}\n`, 'utf8');
  } catch {
    // Advisory only: an unwritable home just means asking again next time.
  }
}

/** A checkedAt in the future (clock moved back) is not fresh either. */
function isFresh(cache: UpdateCache, now: number): boolean {
  const age = now - cache.checkedAt;
  return age >= 0 && age < UPDATE_CHECK_TTL_MS;
}

function unknown(version: string, reason: string): CliCurrency {
  return { version, latest: null, state: 'unknown', reason };
}

function classify(version: string, latest: string | null): CliCurrency {
  if (latest === null) return unknown(version, 'no npm registry answered');
  const order = compareVersions(latest, version);
  if (order === null) return { ...unknown(version, `cannot compare ${version} with ${latest}`), latest };
  return { version, latest, state: order === 1 ? 'outdated' : 'current' };
}

export interface CurrencyCheckOptions {
  env: ConfigEnv;
  version: string;
  policy: UpdatePolicy;
  fetchLatestVersion?: () => Promise<string | null>;
}

/**
 * Resolves this CLI's currency under `policy`. Never rejects. A failed query
 * is cached like a successful one, so a blocked network costs one budget a
 * day rather than one per command.
 */
export async function checkCliCurrency(options: CurrencyCheckOptions): Promise<CliCurrency> {
  const { env, version, policy, fetchLatestVersion } = options;
  if (policy === 'none') return unknown(version, 'not checked by this command');
  if (updateCheckDisabled(env)) return unknown(version, `${UPDATE_CHECK_OPT_OUT} is set`);
  if (!fetchLatestVersion) return unknown(version, 'this build has no update check');

  const now = Date.now();
  if (policy === 'daily') {
    const cached = await readCache(updateCheckPath(env));
    if (cached && isFresh(cached, now)) return classify(version, cached.latest);
  }
  let latest: string | null;
  try {
    latest = await fetchLatestVersion();
  } catch {
    latest = null;
  }
  await writeCache(env, { checkedAt: now, latest });
  return classify(version, latest);
}

/**
 * The one line an outdated CLI adds to stderr. SKILL.md quotes it with
 * `<latest>` / `<version>` placeholders and `cli-main.test.ts` checks that
 * quote against what the CLI really prints; reword both together. It points at
 * `favbase doctor`, not a bare `favbase install-skill`: doctor names the exact
 * skill copies to refresh, while a bare install-skill writes every agent's.
 */
export function updateNotice(currency: CliCurrency): string | null {
  if (currency.state !== 'outdated') return null;
  return `[favbase] favbase ${currency.latest} is available (installed ${currency.version}). Upgrade with npm install -g favbase@latest, then run favbase doctor.`;
}
