/**
 * Pure batch / SQL string helpers shared by every platform sync-service.
 * Zero imports, zero side effects — safe to load in offscreen documents (which
 * have no chrome.storage). Extracted per audit docs/15 MEDIUM-3: these were
 * byte-identical copies in 4 sync-services, and `escapeLike` is the single
 * ILIKE-injection defense — one copy, not four drift-prone ones.
 */

/** Split an array into fixed-size batches (keeps INSERT bind-params < PG 65535). */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Escape LIKE/ILIKE metacharacters in user input (default `\` escape char). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, '\\$&');
}
