/**
 * Shared response-reading helpers for platform HTTP adapters (docs/32 Step 3):
 * the error-snippet cut and the "a 200 whose body is not JSON is an error"
 * parse that x-api.ts, zhihu-api.ts and youtube-api.ts each used to write out.
 * Pure leaf like backoff.ts: no storage, no DB, no chrome.* — safe in any
 * runtime.
 *
 * Parsing takes the body text the caller ALREADY read, never the Response: a
 * body is single-use, and callers still need the raw text after parsing (x and
 * zhihu quote it in later errors) or before it (youtube reads 400/403 reasons
 * out of it before looking at the status). The message wording ("<what> with
 * non-JSON body: …") stays the caller's through `what` and `suffix`.
 */

/** How much of a response body a thrown error quotes — enough to diagnose, bounded for logs. */
const SNIPPET_CHARS = 300;

/** The part of a body (or any diagnostic text) a thrown error quotes. */
export function textSnippet(text: string): string {
  return text.slice(0, SNIPPET_CHARS);
}

/** Read the body and cut the snippet; '' when the body cannot be read (already consumed, aborted). */
export async function bodySnippet(res: Response): Promise<string> {
  try {
    return textSnippet(await res.text());
  } catch {
    return '';
  }
}

/**
 * `JSON.parse(raw)`; a body that is not JSON (a challenge page, an HTML error)
 * throws `${what} with non-JSON body: ${snippet}${suffix}` instead of being
 * mistaken for an empty result.
 */
export function parseJsonBody(raw: string, what: string, suffix = ''): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${what} with non-JSON body: ${textSnippet(raw)}${suffix}`);
  }
}
