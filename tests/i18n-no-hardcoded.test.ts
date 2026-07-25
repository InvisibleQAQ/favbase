import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardrail: no hardcoded user-facing CJK text in entrypoints/**\/*.tsx.
 *
 * All user-facing strings must go through the i18n system (`t()`). This test
 * strips comments (line + block) then fails if any CJK character remains,
 * reporting the offending file:line.
 *
 * Scope note: this only catches CJK (Chinese) hardcoding. English display copy
 * is not detected (high false-positive cost) and relies on code review.
 *
 * `// i18n-ignore` on a line exempts that single line (use sparingly).
 */

const ENTRYPOINTS_DIR = path.resolve(__dirname, '../entrypoints');
const CJK = /[一-鿿]/;

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walkTsx(full));
    } else if (full.endsWith('.tsx')) {
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

describe('i18n guard: no hardcoded CJK in entrypoints tsx', () => {
  it('has no untranslated Chinese text', () => {
    const files = walkTsx(ENTRYPOINTS_DIR);
    const offenders: string[] = [];

    for (const file of files) {
      const cleaned = stripBlockComments(readFileSync(file, 'utf8'));
      const lines = cleaned.split('\n');
      lines.forEach((rawLine, i) => {
        if (rawLine.includes('i18n-ignore')) return;
        const line = stripLineComment(rawLine);
        if (CJK.test(line)) {
          const rel = path.relative(path.resolve(__dirname, '..'), file);
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders, `Hardcoded CJK found:\n${offenders.join('\n')}`).toEqual([]);
  });
});
