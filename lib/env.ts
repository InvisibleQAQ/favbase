/**
 * Build-time numeric env override helper — the single reader of
 * `import.meta.env` for platform policy numbers (page delays, retry caps,
 * page sizes, content thresholds). Pure leaf module (no storage, no DB, no
 * chrome.*) — safe to import from any runtime, mirroring lib/format.ts.
 *
 * Contract (settled 2026-08-18, docs survey v3):
 * - Defaults live at each platform's constant definition, NOT here:
 *   `const PAGE_DELAY_MS = envNumber('VITE_GITHUB_PAGE_DELAY_MS', 100);`
 * - An env value overrides ONLY when it parses to a finite non-negative
 *   number (0 is valid — e.g. zeroing a delay for local debugging). Absent,
 *   empty, or invalid values silently fall back (same posture as
 *   resolveHttpDeadlineMs in lib/http/fetch-with-deadline.ts). No clamping.
 * - Values are inlined at build time — edit `.env.local`, re-run `pnpm dev`.
 *   Every key must be documented in the platform blocks of `.env.example` /
 *   `.env.local` (tests/platform-env-constants-guard.test.ts enforces the
 *   call-site ↔ docs sync and bans bare numeric constants in platform dirs).
 *
 * Works in production builds: Vite replaces a bare `import.meta.env` with an
 * object literal containing every VITE_-prefixed key defined at build time
 * (verified against vite 8 define plugin), so the dynamic `env[key]` lookup
 * below survives bundling; keys absent from the env files simply resolve to
 * `undefined` → fallback.
 */
export function envNumber(key: `VITE_${string}`, fallback: number): number {
  const env = import.meta.env as Record<string, string | undefined>;
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value;
}
