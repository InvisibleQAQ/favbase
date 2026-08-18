import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardrail (architecture audit 2026-08-17 #5): every remote request in
 * lib/** must go through `fetchWithDeadline` (lib/http/fetch-with-deadline.ts)
 * so the unified `VITE_HTTP_DEADLINE_SECONDS` deadline applies — including
 * platforms added in the future. A bare `fetch(` (or `globalThis/window/self
 * .fetch(`) fails this test unless the file is allowlisted below with a
 * reason. Comments are stripped first; offenders are reported as file:line.
 *
 * Allowlisting is file-level and must state WHY a fixed whole-request deadline
 * would break that file's semantics (streaming / large payloads). A stale
 * entry (file gone, or no bare fetch left) also fails — keep the list honest.
 */

const ROOT = path.resolve(__dirname, '..');
const LIB_DIR = path.join(ROOT, 'lib');

const ALLOWED_BARE_FETCH: Record<string, string> = {
  'lib/http/fetch-with-deadline.ts': 'the deadline wrapper itself',
  'lib/ai/index.ts': 'LLM calls — streaming responses can legitimately run for minutes',
  'lib/transcription/groq-client.ts': 'ASR upload — large audio payloads exceed a fixed deadline',
  'lib/transcription/audio-extractor.ts': 'audio download for ASR — large payloads',
  'lib/offscreen/ffmpeg-subsystem.ts': 'FFmpeg core download — large one-off asset fetch',
};

const BARE_FETCH = /(?<![\w$.])fetch\s*\(|(?:globalThis|window|self)\s*\.\s*fetch\s*\(/;

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTs(full));
    } else if (
      (full.endsWith('.ts') || full.endsWith('.tsx')) &&
      !full.endsWith('.test.ts') &&
      !full.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Remove block comments while preserving newline count so line numbers stay accurate. */
function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Remove a line comment (`//...`) from a single line. */
function stripLineComment(line: string): string {
  const idx = line.indexOf('//');
  return idx === -1 ? line : line.slice(0, idx);
}

function bareFetchLines(file: string): number[] {
  const cleaned = stripBlockComments(readFileSync(file, 'utf8'));
  const hits: number[] = [];
  cleaned.split('\n').forEach((rawLine, i) => {
    if (BARE_FETCH.test(stripLineComment(rawLine))) hits.push(i + 1);
  });
  return hits;
}

function toRel(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

describe('http deadline guard: no bare fetch in lib/**', () => {
  it('routes every lib fetch through fetchWithDeadline', () => {
    const offenders: string[] = [];
    for (const file of walkTs(LIB_DIR)) {
      const rel = toRel(file);
      if (rel in ALLOWED_BARE_FETCH) continue;
      for (const line of bareFetchLines(file)) {
        offenders.push(`${rel}:${line}`);
      }
    }
    expect(
      offenders,
      `Bare fetch() found — use fetchWithDeadline from lib/http/fetch-with-deadline.ts ` +
        `(or allowlist the file with a reason):\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const stale: string[] = [];
    for (const rel of Object.keys(ALLOWED_BARE_FETCH)) {
      const full = path.join(ROOT, rel);
      if (!existsSync(full) || bareFetchLines(full).length === 0) stale.push(rel);
    }
    expect(
      stale,
      `Allowlist entries without a bare fetch — remove them:\n${stale.join('\n')}`,
    ).toEqual([]);
  });
});
