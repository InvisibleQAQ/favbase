/**
 * GitHub API layer — all GitHub REST calls consolidated here.
 * Mirrors lib/bilibili/bilibili-api.ts role: URL builders, response
 * normalization, structured errors. No UI copy, no i18n (seam is at UI).
 */

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.github.com';
const PER_PAGE = 100; // GitHub hard maximum
const PAGE_DELAY_MS = 100;

/** `sort=created&direction=desc` = starred time descending — stable order for pagination. */
const ENDPOINTS = {
  starred: (page: number) =>
    `${API_BASE}/user/starred?per_page=${PER_PAGE}&sort=created&direction=desc&page=${page}`,
  user: () => `${API_BASE}/user`,
} as const;

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    // star+json variant: each element is { starred_at, repo } instead of a bare repo.
    Accept: 'application/vnd.github.star+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// ---------------------------------------------------------------------------
// Errors — structured, no UI copy (i18n seam is at the UI boundary)
// ---------------------------------------------------------------------------

export class GithubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubAuthError';
  }
}

export class GithubRateLimitError extends Error {
  /** When the rate limit window resets (from X-RateLimit-Reset), null if header missing. */
  readonly resetAt: Date | null;

  constructor(message: string, resetAt: Date | null) {
    super(message);
    this.name = 'GithubRateLimitError';
    this.resetAt = resetAt;
  }
}

/** Classify non-ok responses into structured errors. */
function throwForStatus(res: Response): never {
  if (res.status === 401) {
    throw new GithubAuthError('GitHub token invalid or expired');
  }
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = res.headers.get('x-ratelimit-reset');
    const resetAt = reset ? new Date(Number(reset) * 1000) : null;
    throw new GithubRateLimitError('GitHub API rate limit exceeded', resetAt);
  }
  throw new Error(`GitHub API HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Types — only the fields we consume (never `any`)
// ---------------------------------------------------------------------------

/** Raw repo shape from the GitHub API (subset we consume). */
interface RawRepo {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  topics?: string[];
  created_at: string;
  pushed_at: string | null;
  owner: { login: string; avatar_url: string };
}

/** star+json response element: { starred_at, repo }. */
interface RawStarredEntry {
  starred_at: string;
  repo: RawRepo;
}

/** Flattened starred repo — star+json entry with starredAt merged in. */
export interface GithubStarredRepo {
  id: number;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  topics: string[];
  createdAt: string;
  pushedAt: string | null;
  starredAt: string;
  owner: { login: string; avatarUrl: string };
}

export interface GithubUser {
  login: string;
  avatarUrl: string;
}

/** Progress callback: after each fetched page. `totalPages` from the Link header (1 when absent). */
export type StarsProgressCallback = (
  page: number,
  totalPages: number,
  fetchedCount: number,
) => void;

// ---------------------------------------------------------------------------
// Link header parsing (pure — exported for unit tests)
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub `Link` response header and return the `rel="last"` page
 * number, or null when the header is absent / has no last rel (single page,
 * or already on the last page).
 */
export function parseLinkHeader(header: string | null): number | null {
  if (!header) return null;

  for (const part of header.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="last"/);
    if (!match) continue;
    try {
      const page = new URL(match[1]).searchParams.get('page');
      const n = page ? Number(page) : NaN;
      return Number.isInteger(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

function flattenEntry(entry: RawStarredEntry): GithubStarredRepo {
  const r = entry.repo;
  return {
    id: r.id,
    fullName: r.full_name,
    htmlUrl: r.html_url,
    description: r.description,
    language: r.language,
    stargazersCount: r.stargazers_count,
    forksCount: r.forks_count,
    topics: r.topics ?? [],
    createdAt: r.created_at,
    pushedAt: r.pushed_at,
    starredAt: entry.starred_at,
    owner: { login: r.owner.login, avatarUrl: r.owner.avatar_url },
  };
}

async function fetchStarredPage(
  token: string,
  page: number,
): Promise<{ repos: GithubStarredRepo[]; linkHeader: string | null }> {
  const res = await fetch(ENDPOINTS.starred(page), { headers: buildHeaders(token) });
  if (!res.ok) throwForStatus(res);

  const entries: RawStarredEntry[] = await res.json();
  return {
    repos: entries.map(flattenEntry),
    linkHeader: res.headers.get('link'),
  };
}

/**
 * Fetch ALL starred repos for the authenticated user, page by page.
 * Total pages come from the first page's Link header (`rel="last"`);
 * absent header = single page. ~100ms delay between pages as a
 * courtesy throttle.
 */
export async function fetchAllStarred(
  token: string,
  onProgress?: StarsProgressCallback,
): Promise<GithubStarredRepo[]> {
  const first = await fetchStarredPage(token, 1);
  const totalPages = parseLinkHeader(first.linkHeader) ?? 1;
  const all: GithubStarredRepo[] = [...first.repos];
  onProgress?.(1, totalPages, all.length);

  for (let page = 2; page <= totalPages; page++) {
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    const { repos } = await fetchStarredPage(token, page);
    all.push(...repos);
    onProgress?.(page, totalPages, all.length);
    if (repos.length < PER_PAGE) break; // defensive: server says no more
  }

  return all;
}

/** Validate a PAT via GET /user. Throws GithubAuthError on 401. */
export async function validateToken(token: string): Promise<GithubUser> {
  const res = await fetch(ENDPOINTS.user(), { headers: buildHeaders(token) });
  if (!res.ok) throwForStatus(res);

  const json: { login: string; avatar_url: string } = await res.json();
  return { login: json.login, avatarUrl: json.avatar_url };
}
