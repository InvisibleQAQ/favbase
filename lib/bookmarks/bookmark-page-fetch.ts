/** Network-only bookmark page retrieval. Safe to import from the background SW. */

export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_HTML_BYTES = 5 * 1024 * 1024;
const META_PRESCAN_BYTES = 1024;

export type FetchPageResult =
  | { kind: 'ok'; html: string }
  | { kind: 'permanent'; reason: 'invalid-url' | 'http-4xx' | 'not-html' | 'too-large' }
  | { kind: 'transient'; reason: 'http-5xx' | 'http-429' | 'timeout' | 'network' };

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
];

export function classifyUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  if (host.startsWith('[')) {
    const v6 = host.slice(1, -1);
    return !(v6 === '::1' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd'));
  }
  if (host === 'localhost' || host.endsWith('.local') || !host.includes('.')) return false;
  return !PRIVATE_IPV4.some((pattern) => pattern.test(host));
}

function normalizeCharset(label: string): string {
  const normalized = label.trim().replace(/^["']|["']$/g, '').toLowerCase();
  return normalized === 'gb2312' || normalized === 'gbk' ? 'gb18030' : normalized;
}

function decodeWith(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function decodeHtmlBytes(buffer: ArrayBuffer, contentTypeHeader: string | null): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return decodeWith(bytes, 'utf-8');
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return decodeWith(bytes, 'utf-16le');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return decodeWith(bytes, 'utf-16be');

  const headerMatch = /charset\s*=\s*("[^"]*"|'[^']*'|[^;\s]+)/i.exec(contentTypeHeader ?? '');
  if (headerMatch) return decodeWith(bytes, normalizeCharset(headerMatch[1]));

  const prescan = new TextDecoder('latin1').decode(bytes.subarray(0, META_PRESCAN_BYTES));
  const metaMatch = /<meta[^>]+charset\s*=\s*("[^"]*"|'[^']*'|[\w-]+)/i.exec(prescan);
  if (metaMatch) return decodeWith(bytes, normalizeCharset(metaMatch[1]));
  return decodeWith(bytes, 'utf-8');
}

async function readBodyCapped(res: Response): Promise<ArrayBuffer | null> {
  if (!res.body) return res.arrayBuffer();

  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output.buffer;
}

export async function fetchBookmarkPage(
  url: string,
  fetchFn: FetchFn = (input, init) => fetch(input, init),
): Promise<FetchPageResult> {
  try {
    const response = await fetchFn(url, {
      credentials: 'omit',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5' },
    });

    if (response.status >= 500) return { kind: 'transient', reason: 'http-5xx' };
    if (response.status === 429) return { kind: 'transient', reason: 'http-429' };
    if (!response.ok) return { kind: 'permanent', reason: 'http-4xx' };

    const contentType = response.headers.get('content-type');
    const mediaType = (contentType ?? '').split(';')[0].trim().toLowerCase();
    if (mediaType && mediaType !== 'text/html' && mediaType !== 'application/xhtml+xml') {
      await response.body?.cancel().catch(() => {});
      return { kind: 'permanent', reason: 'not-html' };
    }

    const buffer = await readBodyCapped(response);
    if (buffer === null) return { kind: 'permanent', reason: 'too-large' };
    return { kind: 'ok', html: decodeHtmlBytes(buffer, contentType) };
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { kind: 'transient', reason: 'timeout' };
    }
    return { kind: 'transient', reason: 'network' };
  }
}
