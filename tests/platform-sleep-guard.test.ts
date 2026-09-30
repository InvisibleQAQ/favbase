import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';

import { PLATFORM_DIRS } from './platform-env-guard-contract';

/**
 * Guardrail (docs/32 Step 3): a platform directory never hand-rolls a wait out
 * of `new Promise` + `setTimeout`. Waits, delays and transient-error retries
 * are shared mechanism in `lib/http/` — only the numbers and the "which
 * response retries, how long, what to throw when spent" belong to the
 * platform. Sibling of tests/http-fetch-deadline-guard.test.ts; scans every
 * platform directory derived from COLLECTION_PLATFORMS, so future platforms
 * inherit the rule.
 *
 * Read by AST, not by text: a `setTimeout(...)` call anywhere inside the
 * arguments of `new Promise(...)` is a wait. Both names match bare or read off
 * `globalThis` / `window` / `self` (dotted or `['…']`), through type-only
 * wrappers (`(… as any)`, `!`). A `setTimeout` outside any `new Promise` is a
 * timer callback (`setTimeout(send, 0)`, a stored `const t = setTimeout(...)`
 * handle) and passes. Known gap: an alias (`const st = setTimeout`) is not
 * followed.
 */

const ROOT = path.resolve(__dirname, '..');

const FIX =
  'wait with `sleep` from lib/http/backoff.ts, compute delays with `jitteredDelayMs` / ' +
  '`backoffDelayMs`, and retry transient errors with `withRetries` from lib/http/retry.ts';

const GLOBAL_HOSTS = new Set(['globalThis', 'window', 'self']);

/** Strip wrappers that change the type but not the value: `(x)`, `x as T`, `x!`, `x satisfies T`, `<T>x`. */
function unwrap(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current)
    || ts.isAsExpression(current)
    || ts.isNonNullExpression(current)
    || ts.isSatisfiesExpression(current)
    || ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/**
 * True when `expr` names the global `name`: bare, or read off a global host
 * (`globalThis.name`, `window['name']`, `(self as any).name`). An alias
 * (`const st = setTimeout`) is not followed — that needs data flow.
 */
function namesGlobal(expr: ts.Expression, name: string): boolean {
  const node = unwrap(expr);
  if (ts.isIdentifier(node)) return node.text === name;
  let host: ts.Expression;
  if (ts.isPropertyAccessExpression(node)) {
    if (node.name.text !== name) return false;
    host = node.expression;
  } else if (ts.isElementAccessExpression(node)) {
    const key = node.argumentExpression;
    if (!ts.isStringLiteralLike(key) || key.text !== name) return false;
    host = node.expression;
  } else {
    return false;
  }
  const hostNode = unwrap(host);
  return ts.isIdentifier(hostNode) && GLOBAL_HOSTS.has(hostNode.text);
}

function isSetTimeoutCall(node: ts.Node): boolean {
  return ts.isCallExpression(node) && namesGlobal(node.expression, 'setTimeout');
}

function isPromiseConstruction(node: ts.Node): node is ts.NewExpression {
  return ts.isNewExpression(node) && namesGlobal(node.expression, 'Promise');
}

/** 1-based lines of every `setTimeout(...)` call inside a `new Promise(...)` argument. */
function promiseTimeoutWaitLines(source: string, fileName = 'probe.ts'): number[] {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node, insidePromise: boolean): void => {
    if (insidePromise && isSetTimeoutCall(node)) {
      lines.push(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1);
    }
    if (isPromiseConstruction(node)) {
      for (const arg of node.arguments ?? []) visit(arg, true);
      return;
    }
    node.forEachChild((child) => visit(child, insidePromise));
  };
  visit(ast, false);
  return lines;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx'))
      && !full.endsWith('.test.ts')
      && !full.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

function toRel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

describe('platform sleep guard: no hand-rolled setTimeout waits in lib/<platform>/', () => {
  it('detects Promise-wrapped setTimeout waits and lets timer callbacks through', () => {
    const waits = [
      'await new Promise((r) => setTimeout(r, 1));',
      'await new Promise((resolve) => { setTimeout(() => resolve(), 5); });',
      'await new Promise<void>((r) => globalThis.setTimeout(r, 1));',
      'await new Promise((r) => window.setTimeout(r, 1));',
      'await new Promise((r) => self.setTimeout(r, 1));',
      'await new Promise(function (resolve) { setTimeout(resolve, 1); });',
      'await new Promise((r) => (globalThis as any).setTimeout(r, 1));',
      'await new Promise((r) => setTimeout!(r, 1));',
      "await new Promise((r) => window['setTimeout'](r, 1));",
      'await new Promise((r) => setTimeout?.(r, 1));',
      'await new globalThis.Promise((r) => setTimeout(r, 1));',
    ];
    for (const source of waits) {
      expect(promiseTimeoutWaitLines(source), source).toEqual([1]);
    }

    const callbacks = [
      'setTimeout(send, 0);',
      'const t = setTimeout(fn, 100);',
      'await sleep(100);',
      'timer = globalThis.setTimeout(tick, 1000);',
      "await new Promise((r) => window['clearTimeout'](r));",
    ];
    for (const source of callbacks) {
      expect(promiseTimeoutWaitLines(source), source).toEqual([]);
    }
  });

  it('scans every platform directory', () => {
    for (const dir of PLATFORM_DIRS) {
      const full = path.join(ROOT, dir);
      expect(existsSync(full), `${dir} is missing`).toBe(true);
      expect(walkTs(full).length, `${dir} has no source files`).toBeGreaterThan(0);
    }
  });

  it('waits through lib/http/backoff.ts sleep', () => {
    const offenders: string[] = [];
    for (const dir of PLATFORM_DIRS) {
      for (const file of walkTs(path.join(ROOT, dir))) {
        const rel = toRel(file);
        for (const line of promiseTimeoutWaitLines(readFileSync(file, 'utf8'), rel)) {
          offenders.push(`${rel}:${line}`);
        }
      }
    }
    expect(
      offenders,
      `Hand-rolled setTimeout wait in a platform directory — ${FIX}:\n`
        + offenders.map((item) => `- ${item}`).join('\n'),
    ).toEqual([]);
  });
});
