import { describe, it, expect } from 'vitest';
import {
  classifyUrl,
  decodeHtmlBytes,
  fetchBookmarkPage,
  extractMarkdown,
  meetsContentThreshold,
  MIN_CONTENT_CHARS,
  MAX_HTML_BYTES,
  type FetchFn,
} from './bookmark-content';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** GBK bytes for「中文」(TextEncoder can't produce GBK — hardcoded literal). */
const GBK_ZHONGWEN = [0xd6, 0xd0, 0xce, 0xc4];

function asciiBytes(s: string): number[] {
  return [...s].map((c) => c.charCodeAt(0));
}

function toBuffer(...parts: number[][]): ArrayBuffer {
  return new Uint8Array(parts.flat()).buffer;
}

/**
 * Environment-independent Response stand-in — only the surface
 * fetchBookmarkPage touches (status/ok/headers.get/body reader/arrayBuffer).
 */
function stubResponse(opts: {
  status?: number;
  contentType?: string | null;
  chunks?: Uint8Array[];
  onCancel?: () => void;
}): Response {
  const status = opts.status ?? 200;
  const chunks = opts.chunks ?? [];
  const body = {
    getReader() {
      let i = 0;
      return {
        read: async () =>
          i < chunks.length
            ? { done: false as const, value: chunks[i++] }
            : { done: true as const, value: undefined },
        cancel: async () => opts.onCancel?.(),
      };
    },
    cancel: async () => opts.onCancel?.(),
  };
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? (opts.contentType ?? null) : null,
    },
    body,
    arrayBuffer: async () => {
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const out = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
      }
      return out.buffer;
    },
  } as unknown as Response;
}

function htmlChunks(html: string): Uint8Array[] {
  return [new TextEncoder().encode(html)];
}

function errorWithName(name: string): Error {
  return Object.assign(new Error(name), { name });
}

// ---------------------------------------------------------------------------
// classifyUrl
// ---------------------------------------------------------------------------

describe('classifyUrl', () => {
  it('accepts public http(s) URLs', () => {
    expect(classifyUrl('https://example.com/a')).toBe(true);
    expect(classifyUrl('http://sub.example.co.uk/x?q=1')).toBe(true);
    expect(classifyUrl('https://8.8.8.8/dns')).toBe(true);
  });

  it('rejects non-http(s) schemes and unparseable strings', () => {
    expect(classifyUrl('ftp://example.com/f')).toBe(false);
    expect(classifyUrl('chrome://settings')).toBe(false);
    expect(classifyUrl('javascript:void(0)')).toBe(false);
    expect(classifyUrl('not a url')).toBe(false);
  });

  it('rejects localhost, .local, and dotless intranet hosts', () => {
    expect(classifyUrl('http://localhost:3000/app')).toBe(false);
    expect(classifyUrl('http://nas.local/share')).toBe(false);
    expect(classifyUrl('http://wiki/page')).toBe(false);
  });

  it('rejects private/loopback IPv4 literals, accepts adjacent public ranges', () => {
    expect(classifyUrl('http://127.0.0.1/')).toBe(false);
    expect(classifyUrl('http://10.1.2.3/')).toBe(false);
    expect(classifyUrl('http://192.168.1.1/admin')).toBe(false);
    expect(classifyUrl('http://169.254.0.5/')).toBe(false);
    expect(classifyUrl('http://172.16.0.1/')).toBe(false);
    expect(classifyUrl('http://172.31.255.255/')).toBe(false);
    // 172.16.0.0/12 boundary — these are public.
    expect(classifyUrl('http://172.15.0.1/')).toBe(true);
    expect(classifyUrl('http://172.32.0.1/')).toBe(true);
  });

  it('rejects loopback/link-local/unique-local IPv6, accepts global IPv6', () => {
    expect(classifyUrl('http://[::1]/')).toBe(false);
    expect(classifyUrl('http://[fe80::1]/')).toBe(false);
    expect(classifyUrl('http://[fd00::1]/')).toBe(false);
    expect(classifyUrl('http://[2001:db8::1]/')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// decodeHtmlBytes
// ---------------------------------------------------------------------------

describe('decodeHtmlBytes', () => {
  it('defaults to utf-8 when nothing declares a charset', () => {
    const html = '<html><body>héllo 中文</body></html>';
    const buf = new TextEncoder().encode(html).buffer as ArrayBuffer;
    expect(decodeHtmlBytes(buf, 'text/html')).toBe(html);
    expect(decodeHtmlBytes(buf, null)).toBe(html);
  });

  it('honors the Content-Type header charset (gbk → gb18030 alias)', () => {
    const buf = toBuffer(asciiBytes('<p>'), GBK_ZHONGWEN, asciiBytes('</p>'));
    expect(decodeHtmlBytes(buf, 'text/html; charset=gbk')).toBe('<p>中文</p>');
    expect(decodeHtmlBytes(buf, 'text/html; charset="GB2312"')).toBe('<p>中文</p>');
  });

  it('falls back to the meta charset prescan when the header has none', () => {
    const buf = toBuffer(
      asciiBytes('<html><head><meta charset="gbk"></head><body>'),
      GBK_ZHONGWEN,
      asciiBytes('</body></html>'),
    );
    expect(decodeHtmlBytes(buf, 'text/html')).toContain('中文');
  });

  it('reads the http-equiv content-type meta variant', () => {
    const buf = toBuffer(
      asciiBytes(
        '<html><head><meta http-equiv="Content-Type" content="text/html; charset=gb2312"></head><body>',
      ),
      GBK_ZHONGWEN,
      asciiBytes('</body></html>'),
    );
    expect(decodeHtmlBytes(buf, null)).toContain('中文');
  });

  it('BOM wins over a lying header charset', () => {
    const utf8 = [...new TextEncoder().encode('中文')];
    const buf = toBuffer([0xef, 0xbb, 0xbf], utf8);
    expect(decodeHtmlBytes(buf, 'text/html; charset=gbk')).toBe('中文');
  });

  it('unknown charset labels fall back to utf-8', () => {
    const html = '<p>ok</p>';
    const buf = new TextEncoder().encode(html).buffer as ArrayBuffer;
    expect(decodeHtmlBytes(buf, 'text/html; charset=bogus-enc')).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// fetchBookmarkPage
// ---------------------------------------------------------------------------

describe('fetchBookmarkPage', () => {
  it('returns decoded html on 200 text/html and sends anonymous, timed-out GET', async () => {
    const inits: RequestInit[] = [];
    const fetchFn: FetchFn = async (_url, init) => {
      inits.push(init!);
      return stubResponse({
        contentType: 'text/html; charset=utf-8',
        chunks: htmlChunks('<html><body>hello</body></html>'),
      });
    };
    const result = await fetchBookmarkPage('https://example.com/a', fetchFn);
    expect(result).toEqual({ kind: 'ok', html: '<html><body>hello</body></html>' });
    expect(inits[0].credentials).toBe('omit');
    expect(inits[0].signal).toBeDefined();
  });

  it('decodes non-UTF-8 bodies via the header charset', async () => {
    const fetchFn: FetchFn = async () =>
      stubResponse({
        contentType: 'text/html; charset=gbk',
        chunks: [new Uint8Array([...asciiBytes('<p>'), ...GBK_ZHONGWEN, ...asciiBytes('</p>')])],
      });
    const result = await fetchBookmarkPage('https://example.com/gbk', fetchFn);
    expect(result).toEqual({ kind: 'ok', html: '<p>中文</p>' });
  });

  it('treats a missing content-type as probably-HTML', async () => {
    const fetchFn: FetchFn = async () =>
      stubResponse({ contentType: null, chunks: htmlChunks('<p>old server</p>') });
    expect(await fetchBookmarkPage('https://example.com/', fetchFn)).toEqual({
      kind: 'ok',
      html: '<p>old server</p>',
    });
  });

  it('classifies 4xx permanent and 5xx transient', async () => {
    const notFound: FetchFn = async () => stubResponse({ status: 404 });
    expect(await fetchBookmarkPage('https://x.com/', notFound)).toEqual({
      kind: 'permanent',
      reason: 'http-4xx',
    });

    const serverError: FetchFn = async () => stubResponse({ status: 503 });
    expect(await fetchBookmarkPage('https://x.com/', serverError)).toEqual({
      kind: 'transient',
      reason: 'http-5xx',
    });
  });

  it('classifies 429 (rate limited) as transient — the content exists', async () => {
    const rateLimited: FetchFn = async () => stubResponse({ status: 429 });
    expect(await fetchBookmarkPage('https://x.com/', rateLimited)).toEqual({
      kind: 'transient',
      reason: 'http-429',
    });
  });

  it('aborts non-HTML content types without reading the body', async () => {
    let cancelled = false;
    const fetchFn: FetchFn = async () =>
      stubResponse({
        contentType: 'application/pdf',
        chunks: htmlChunks('%PDF-'),
        onCancel: () => {
          cancelled = true;
        },
      });
    expect(await fetchBookmarkPage('https://x.com/doc.pdf', fetchFn)).toEqual({
      kind: 'permanent',
      reason: 'not-html',
    });
    expect(cancelled).toBe(true);
  });

  it('cancels and reports too-large past the byte cap', async () => {
    const chunk = new Uint8Array(2 * 1024 * 1024); // 3 chunks > 5MB cap
    let cancelled = false;
    const fetchFn: FetchFn = async () =>
      stubResponse({
        contentType: 'text/html',
        chunks: [chunk, chunk, chunk],
        onCancel: () => {
          cancelled = true;
        },
      });
    expect(await fetchBookmarkPage('https://x.com/huge', fetchFn)).toEqual({
      kind: 'permanent',
      reason: 'too-large',
    });
    expect(cancelled).toBe(true);
    expect(3 * chunk.byteLength).toBeGreaterThan(MAX_HTML_BYTES);
  });

  it('maps timeout aborts and network errors to transient', async () => {
    const timeout: FetchFn = async () => {
      throw errorWithName('TimeoutError');
    };
    expect(await fetchBookmarkPage('https://x.com/', timeout)).toEqual({
      kind: 'transient',
      reason: 'timeout',
    });

    const aborted: FetchFn = async () => {
      throw errorWithName('AbortError');
    };
    expect(await fetchBookmarkPage('https://x.com/', aborted)).toEqual({
      kind: 'transient',
      reason: 'timeout',
    });

    const network: FetchFn = async () => {
      throw new TypeError('fetch failed');
    };
    expect(await fetchBookmarkPage('https://x.com/', network)).toEqual({
      kind: 'transient',
      reason: 'network',
    });
  });
});

// ---------------------------------------------------------------------------
// extractMarkdown + threshold guard
// ---------------------------------------------------------------------------

function articleHtml(): string {
  const paragraphs = Array.from(
    { length: 6 },
    (_, i) =>
      `<p>Paragraph ${i} with enough prose to clear the two-hundred character extraction threshold comfortably and without any ambiguity in the assertion below.</p>`,
  ).join('\n');
  return `<!doctype html><html><head><title>Post</title></head><body>
    <nav>nav junk</nav>
    <article><h1>Real Title</h1>${paragraphs}<p>See the <a href="/about">about page</a>.</p></article>
    <footer>footer junk</footer>
  </body></html>`;
}

describe('meetsContentThreshold', () => {
  it('gates on trimmed length against MIN_CONTENT_CHARS', () => {
    expect(meetsContentThreshold('')).toBe(false);
    expect(meetsContentThreshold('   \n  ')).toBe(false);
    expect(meetsContentThreshold('x'.repeat(MIN_CONTENT_CHARS - 1))).toBe(false);
    expect(meetsContentThreshold(`  ${'x'.repeat(MIN_CONTENT_CHARS)}  `)).toBe(true);
  });
});

describe('extractMarkdown', () => {
  it('removes malformed JSON-LD before Defuddle parses schema.org data', () => {
    const originalError = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => errors.push(args);
    try {
      const html = `<article><h1>Title</h1><p>${'content '.repeat(40)}</p><script type="application/ld+json">{"@type":"Article"}{"broken":true}</script><script type="application/ld+json">{"@type":"Article","headline":"Title"}</script></article>`;
      expect(extractMarkdown(html, 'https://example.com/article')).not.toBeNull();
      expect(errors).toEqual([]);
    } finally { console.error = originalError; }
  });

  it('extracts article content as markdown with absolute links', () => {
    const result = extractMarkdown(articleHtml(), 'https://example.com/post/1');
    expect(result).not.toBeNull();
    expect(result!.markdown).toContain('Paragraph 0');
    expect(result!.markdown.length).toBeGreaterThanOrEqual(MIN_CONTENT_CHARS);
    // Relative link resolved against the passed url (defuddle `url` option).
    expect(result!.markdown).toContain('https://example.com/about');
  });

  it('returns null for SPA empty shells (below the content threshold)', () => {
    const shell = '<!doctype html><html><body><div id="root"></div></body></html>';
    expect(extractMarkdown(shell, 'https://spa.example.com/')).toBeNull();
  });
});
