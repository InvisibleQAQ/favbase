/**
 * HTTP execution seam — the unified request deadline for every remote-platform
 * HTTP adapter (architecture audit 2026-08-17 #5). Pure leaf module: no
 * storage, no DB, no chrome.* — safe to import from any runtime (Background
 * SW, Content Script, app.html, Offscreen).
 *
 * Deadline value: `VITE_HTTP_DEADLINE_SECONDS` in `.env.local` (seconds,
 * inlined at build time — re-run `pnpm dev` after changing, same as
 * `VITE_EMBEDDING_*`), falling back to DEFAULT_HTTP_DEADLINE_SECONDS. ONE
 * value for all platforms — per-platform overrides are deliberately not
 * supported.
 *
 * The deadline covers the WHOLE request lifetime: the timer is never cleared,
 * so body reads (`res.json()`/`res.text()`/stream readers) abort at the same
 * deadline and reject with the same HttpDeadlineError reason. Aborting an
 * already-consumed response is a no-op, so the armed timer is harmless (and
 * unref'd where available so it never holds a Node test process open).
 *
 * Enforcement: tests/http-fetch-deadline-guard.test.ts fails any bare `fetch(`
 * in lib/** — future platforms inherit the deadline by construction.
 */

export const DEFAULT_HTTP_DEADLINE_SECONDS = 30;

export class HttpDeadlineError extends Error {
  readonly url: string;
  readonly deadlineMs: number;

  constructor(url: string, deadlineMs: number) {
    super(`HTTP deadline of ${deadlineMs / 1000}s exceeded for ${url}`);
    this.name = 'HttpDeadlineError';
    this.url = url;
    this.deadlineMs = deadlineMs;
  }
}

/** Resolved at call time so tests can `vi.stubEnv`; absent/invalid → default. */
export function resolveHttpDeadlineMs(): number {
  const raw = import.meta.env.VITE_HTTP_DEADLINE_SECONDS as string | undefined;
  const seconds = Number(raw);
  if (!raw || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_HTTP_DEADLINE_SECONDS * 1000;
  }
  return seconds * 1000;
}

function describeUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/**
 * `fetch` with the unified deadline. A caller-provided `init.signal` is merged
 * via `AbortSignal.any` (caller aborts propagate their own reason unchanged);
 * the deadline aborts with an HttpDeadlineError reason, so both the request
 * and any later body read reject with a classifiable error.
 */
export function fetchWithDeadline(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const deadlineMs = resolveHttpDeadlineMs();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new HttpDeadlineError(describeUrl(input), deadlineMs)),
    deadlineMs,
  );
  (timer as unknown as { unref?: () => void }).unref?.();

  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  return fetch(input, { ...init, signal });
}
