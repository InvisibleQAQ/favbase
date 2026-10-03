// @vitest-environment happy-dom

import { readFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DouyinRequest, DouyinTransportResult } from './douyin-api';

const browserMock = vi.hoisted(() => ({
  query: vi.fn(),
  executeScript: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { query: browserMock.query },
    scripting: { executeScript: browserMock.executeScript },
  },
}));

import {
  decodePageFetchResult,
  douyinPageFetch,
  douyinTabTransport,
  findDouyinTab,
} from './douyin-tab';

const POST: DouyinRequest = {
  method: 'POST',
  path: '/aweme/v1/web/aweme/listcollection/',
  query: { device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', publish_video_strategy_type: '2' },
  form: { count: '20', cursor: '0' },
  timeoutMs: 50,
};

const GET: DouyinRequest = {
  method: 'GET',
  path: '/aweme/v1/web/collects/list/',
  query: { device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web', cursor: '0', count: '20' },
  timeoutMs: 50,
};

const COMPLETE_TAB = { id: 7, discarded: false, status: 'complete' };

describe('lib/douyin layering (user decision 2026-10-03: request code stays in lib/<p>/)', () => {
  // This leaf is the only chrome-touching module here. The API layer and the
  // sync service stay chrome-free so the import-smoke contract can load them
  // with no `chrome` global — and that contract would NOT notice this leaf
  // being pulled in, because it touches nothing at load time. So the edge is
  // checked here instead.
  it.each(['douyin-api.ts', 'douyin-sync-service.ts'])('%s never imports the tab transport', (file) => {
    const source = readFileSync(path.join(__dirname, file), 'utf8');
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const specifiers = ast.statements
      .filter((node) => ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      .map((node) => (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier)
      .filter((spec): spec is ts.StringLiteral => spec !== undefined && ts.isStringLiteral(spec))
      .map((spec) => spec.text);

    expect(specifiers.filter((spec) => /douyin-tab|wxt\/browser/.test(spec))).toEqual([]);

    const extensionApiReads: string[] = [];
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAccessExpression(node)
        && ts.isIdentifier(node.expression)
        && (node.expression.text === 'chrome' || node.expression.text === 'browser')
      ) {
        extensionApiReads.push(node.getText(ast));
      }
      node.forEachChild(visit);
    };
    visit(ast);
    expect(extensionApiReads).toEqual([]);
  });
});

describe('findDouyinTab (the one resolver: tab gate, probeReady and transport)', () => {
  beforeEach(() => browserMock.query.mockReset());

  it('queries www.douyin.com tabs and returns the first one that is loaded and not discarded', async () => {
    browserMock.query.mockResolvedValue([
      { id: 1, discarded: true, status: 'complete' },
      { id: 2, discarded: false, status: 'loading' },
      { id: 3, discarded: false, status: 'complete' },
      { id: 4, discarded: false, status: 'complete' },
    ]);

    await expect(findDouyinTab()).resolves.toBe(3);
    expect(browserMock.query).toHaveBeenCalledWith({ url: 'https://www.douyin.com/*' });
  });

  it('is null when every douyin.com tab is discarded, loading or id-less, or there is none', async () => {
    browserMock.query.mockResolvedValue([
      { id: 1, discarded: true, status: 'complete' },
      { id: 2, status: 'loading' },
      { status: 'complete' },
    ]);
    await expect(findDouyinTab()).resolves.toBeNull();

    browserMock.query.mockResolvedValue([]);
    await expect(findDouyinTab()).resolves.toBeNull();
  });
});

describe('decodePageFetchResult (the executeScript boundary is unknown)', () => {
  it('passes the three result shapes through', () => {
    expect(decodePageFetchResult({ kind: 'response', status: 200, text: '{}' })).toEqual({
      kind: 'response',
      status: 200,
      text: '{}',
    });
    expect(decodePageFetchResult({ kind: 'sdk-not-ready' })).toEqual({ kind: 'sdk-not-ready' });
    expect(decodePageFetchResult({ kind: 'unreachable', message: 'x' })).toEqual({
      kind: 'unreachable',
      message: 'x',
    });
  });

  it('folds anything else into unreachable instead of trusting it', () => {
    for (const value of [undefined, null, 'ok', 42, {}, { kind: 'response', status: '200', text: '' }, { kind: 'response', status: 200 }, { kind: 'unreachable' }]) {
      expect(decodePageFetchResult(value).kind, JSON.stringify(value) ?? 'undefined').toBe('unreachable');
    }
  });
});

describe('douyinTabTransport (never throws; every failure is a kind)', () => {
  beforeEach(() => {
    browserMock.query.mockReset().mockResolvedValue([COMPLETE_TAB]);
    browserMock.executeScript.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('injects douyinPageFetch into the tab MAIN world with the request as its only argument', async () => {
    browserMock.executeScript.mockResolvedValue([
      { frameId: 0, result: { kind: 'response', status: 200, text: '{"status_code":0}' } },
    ]);

    await expect(douyinTabTransport(POST)).resolves.toEqual({
      kind: 'response',
      status: 200,
      text: '{"status_code":0}',
    });
    expect(browserMock.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      world: 'MAIN',
      func: douyinPageFetch,
      args: [POST],
    });
  });

  it('resolves the tab per request: none usable is unreachable and nothing is injected', async () => {
    browserMock.query.mockResolvedValue([{ id: 7, discarded: true, status: 'complete' }]);

    const result = await douyinTabTransport(GET);

    expect(result.kind).toBe('unreachable');
    expect(browserMock.executeScript).not.toHaveBeenCalled();
  });

  it('turns a failed injection (tab closed, navigated, discarded) into unreachable', async () => {
    browserMock.executeScript.mockRejectedValue(new Error('No tab with id: 7.'));

    const result = await douyinTabTransport(GET);

    expect(result).toEqual({
      kind: 'unreachable',
      message: expect.stringContaining('No tab with id: 7.'),
    });
  });

  it('turns a failing tab query into unreachable too', async () => {
    browserMock.query.mockRejectedValue(new Error('tabs gone'));

    await expect(douyinTabTransport(GET)).resolves.toMatchObject({ kind: 'unreachable' });
  });

  it('gives up after req.timeoutMs when the tab never answers (a frozen page never fires its own timeout)', async () => {
    vi.useFakeTimers();
    browserMock.executeScript.mockReturnValue(new Promise(() => undefined));

    const pending = douyinTabTransport(GET);
    await vi.advanceTimersByTimeAsync(GET.timeoutMs);

    await expect(pending).resolves.toEqual({
      kind: 'unreachable',
      message: expect.stringContaining(`${GET.timeoutMs} ms`),
    });
  });

  it('passes sdk-not-ready through, and folds a missing frame result into unreachable', async () => {
    browserMock.executeScript.mockResolvedValue([{ frameId: 0, result: { kind: 'sdk-not-ready' } }]);
    await expect(douyinTabTransport(GET)).resolves.toEqual({ kind: 'sdk-not-ready' });

    browserMock.executeScript.mockResolvedValue([{ frameId: 0 }]);
    await expect(douyinTabTransport(GET)).resolves.toMatchObject({ kind: 'unreachable' });

    browserMock.executeScript.mockResolvedValue([]);
    await expect(douyinTabTransport(GET)).resolves.toMatchObject({ kind: 'unreachable' });
  });
});

// ---------------------------------------------------------------------------
// The injected function itself. `executeScript` sends `douyinPageFetch` as
// source text and rebuilds it in the page, so the function must survive
// `toString()`: no helper a build step inserts, no closure, no import.
// ---------------------------------------------------------------------------

/** Globals the page provides; anything else referenced but not declared inside is a ReferenceError there. */
const PAGE_GLOBALS = new Set([
  'window',
  'Function',
  'URLSearchParams',
  'AbortSignal',
  'Error',
  'String',
  'undefined',
]);

/** Identifiers `source` reads but never declares (property names and keys excluded). */
function freeIdentifiers(source: string): string[] {
  const ast = ts.createSourceFile('injected.js', `(${source})`, ts.ScriptTarget.Latest, true);
  const declared = new Set<string>();
  const referenced = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) && node.name
    ) {
      declared.add(node.name.text);
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declared.add(node.name.text);
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node)
        || (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!isPropertyName) referenced.add(node.text);
    }
    node.forEachChild(visit);
  };
  visit(ast);
  return [...referenced].filter((name) => !declared.has(name)).sort();
}

describe('douyinPageFetch survives serialization (executeScript ships its source)', () => {
  const source = String(douyinPageFetch);

  it('carries no build helper, import or require', () => {
    for (const token of ['__name', '__async', '__awaiter', '__generator', 'import(', 'import ', 'require(']) {
      expect(source, token).not.toContain(token);
    }
  });

  it('reads nothing but its parameter, its own locals and page globals', () => {
    expect(freeIdentifiers(source).filter((name) => !PAGE_GLOBALS.has(name))).toEqual([]);
  });

  it('the free-identifier probe itself catches a closure reference', () => {
    expect(freeIdentifiers('function f(req) { return OUTER + req.x; }')).toEqual(['OUTER']);
  });
});

describe('douyinPageFetch, rebuilt from its source as the page would run it', () => {
  // Rebuilt from text, so a passing case proves the serialized form works —
  // the extension page's CSP forbids this, the test environment does not.
  const rebuilt = new Function(`return (${String(douyinPageFetch)});`)() as typeof douyinPageFetch;
  const originalFetch = window.fetch;

  afterEach(() => {
    window.fetch = originalFetch;
  });

  it('refuses to send while the page fetch is still native (the SDK has not wrapped it)', async () => {
    const sent = vi.fn();
    // A bound function prints as `[native code]`, like the browser's own fetch.
    window.fetch = sent.bind(null) as unknown as typeof window.fetch;

    await expect(rebuilt(GET)).resolves.toEqual({ kind: 'sdk-not-ready' });
    expect(sent).not.toHaveBeenCalled();
  });

  it('POSTs the form through the wrapped fetch, relative path, credentials included, with a deadline', async () => {
    const wrapped = vi.fn(async () => ({ status: 200, text: async () => '{"status_code":0}' }));
    window.fetch = wrapped as unknown as typeof window.fetch;

    const result: DouyinTransportResult = await rebuilt(POST);

    expect(result).toEqual({ kind: 'response', status: 200, text: '{"status_code":0}' });
    expect(wrapped).toHaveBeenCalledTimes(1);
    const [url, init] = wrapped.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      '/aweme/v1/web/aweme/listcollection/?device_platform=webapp&aid=6383&channel=channel_pc_web&publish_video_strategy_type=2',
    );
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'count=20&cursor=0',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('sends a GET with no body and no content type', async () => {
    const wrapped = vi.fn(async () => ({ status: 403, text: async () => 'Blocked' }));
    window.fetch = wrapped as unknown as typeof window.fetch;

    await expect(rebuilt(GET)).resolves.toEqual({ kind: 'response', status: 403, text: 'Blocked' });
    const [url, init] = wrapped.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/aweme/v1/web/collects/list/?device_platform=webapp&aid=6383&channel=channel_pc_web&cursor=0&count=20');
    expect(init).toMatchObject({ method: 'GET', headers: undefined, body: undefined });
  });

  it('never throws: a network error or abort comes back as unreachable', async () => {
    window.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof window.fetch;

    await expect(rebuilt(GET)).resolves.toEqual({
      kind: 'unreachable',
      message: 'TypeError: Failed to fetch',
    });
  });
});
