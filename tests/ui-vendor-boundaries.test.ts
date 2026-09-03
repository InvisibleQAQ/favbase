import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardrail: heavyweight UI vendors stay behind the one wrapper that owns them.
 *
 * docs/25 cross-step rule 6. Each of these packages brings its own DOM layer
 * and stylesheet; letting callers reach for them directly is how a wrapper
 * becomes decorative and the bundle grows a second copy of the same idea.
 * `lib/**` must never see them at all — it has no DOM.
 *
 * docs/25 Step 5 landed `sonner` in the same table rather than in a second
 * `tests/snackbar-import-boundary.test.ts`: two files enforcing one rule is the
 * rule rotting in one of them.
 */

const ROOT = path.resolve(__dirname, '..');

type VendorRule = {
  /** Bare package name as it appears in an import specifier. */
  pkg: string;
  /** Repo-relative directory allowed to import it. */
  owner: string;
};

const VENDOR_RULES: VendorRule[] = [
  { pkg: 'simplebar-react', owner: 'entrypoints/app/components/scrollbar' },
  { pkg: 'sonner', owner: 'entrypoints/app/components/snackbar' },
];

/** Directories scanned for stray imports. */
const SCAN_DIRS = ['entrypoints', 'lib'];

const SOURCE_EXT = new Set(['.ts', '.tsx', '.css']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (SOURCE_EXT.has(path.extname(full))) {
      out.push(full);
    }
  }
  return out;
}

function importsPackage(source: string, pkg: string): boolean {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // `import x from 'pkg'` / `from 'pkg/sub'` / `import 'pkg/sub.css'` /
  // `require('pkg')` / dynamic `import('pkg')` / css `@import 'pkg/...'`.
  const pattern = new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${escaped}(?:/[^'"]*)?['"]`);
  return pattern.test(source);
}

describe('UI vendor boundaries', () => {
  it.each(VENDOR_RULES)('$pkg is imported only under $owner', ({ pkg, owner }) => {
    const ownerPrefix = path.resolve(ROOT, owner);
    const offenders: string[] = [];

    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.resolve(ROOT, dir))) {
        if (file.startsWith(ownerPrefix + path.sep)) continue;
        if (importsPackage(readFileSync(file, 'utf8'), pkg)) {
          offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'));
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it.each(VENDOR_RULES)('$pkg is reachable from its owner', ({ pkg, owner }) => {
    // A rule guarding a package nobody imports is a rule that silently stops
    // meaning anything.
    const files = walk(path.resolve(ROOT, owner));
    const importers = files.filter((file) => importsPackage(readFileSync(file, 'utf8'), pkg));

    expect(importers.length).toBeGreaterThan(0);
  });
});
