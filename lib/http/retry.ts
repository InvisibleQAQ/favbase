/**
 * Shared transient-error retry loop for platform HTTP adapters (docs/32
 * Step 3): the attempt counter, the cap, the wait and the cooperative
 * checkpoint that x-api.ts and zhihu-api.ts used to write out as two copies of
 * the same `while (true)`. Pure leaf like backoff.ts: no storage, no DB, no
 * chrome.* — safe in any runtime.
 *
 * Only the mechanism is shared. The platform's `attempt` decides which
 * response is worth retrying, how long to wait before the retry and what to
 * throw once retries are spent (by returning `retryAfter(...)`), and it owns
 * every number — the same "mechanism here, numbers there" split as
 * backoff.ts. Anything `attempt` throws propagates untouched and is never
 * retried.
 */

// Type-only (erased at build) and from the leaf file, never the
// `@/lib/collections` barrel: lib/http stays a leaf that does not name the
// barrel, so no later value import from here can pull collections-query (and
// drizzle) into every platform adapter.
import type { CooperativeCheckpoint } from '@/lib/collections/cooperative-checkpoint';
import { sleep } from './backoff';

/** One attempt's request to be retried. Built through `retryAfter`. */
export class RetrySignal {
  constructor(
    /** Wait before the retry; `retry` is 1-based — the retry about to run (backoffDelayMs's contract). */
    readonly delayMs: (retry: number) => number,
    /** Built only when retries are spent; the loop throws what it returns. */
    readonly exhausted: () => Error | Promise<Error>,
  ) {}
}

/** Ask `withRetries` to retry this attempt. Both callbacks run lazily — only if the loop needs them. */
export function retryAfter(
  delayMs: RetrySignal['delayMs'],
  exhausted: RetrySignal['exhausted'],
): RetrySignal {
  return new RetrySignal(delayMs, exhausted);
}

/**
 * Run `attempt` until it returns something other than a `RetrySignal`, at most
 * `maxRetries` retries (`maxRetries + 1` attempts). Every signal of one call
 * counts against the same budget, whatever the reason. Before every attempt,
 * the first included, awaits `control.checkpoint()` when `control` is given.
 * Once the budget is spent, throws what the last signal's `exhausted` builds.
 */
export async function withRetries<T>(
  opts: { maxRetries: number; control?: CooperativeCheckpoint },
  attempt: () => Promise<T | RetrySignal>,
): Promise<T> {
  let retries = 0;
  while (true) {
    await opts.control?.checkpoint();
    const outcome = await attempt();
    if (!(outcome instanceof RetrySignal)) return outcome;
    if (retries >= opts.maxRetries) throw await outcome.exhausted();
    retries += 1;
    await sleep(outcome.delayMs(retries));
  }
}
