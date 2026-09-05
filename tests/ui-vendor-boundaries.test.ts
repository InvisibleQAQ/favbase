import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Guardrail: UI import boundaries that would otherwise live only in prose.
 *
 * Two tables:
 *
 * - `VENDOR_RULES` — heavyweight UI vendors stay behind the one wrapper that
 *   owns them (docs/25 cross-step rule 6). Each of these packages brings its
 *   own DOM layer and stylesheet; letting callers reach for them directly is
 *   how a wrapper becomes decorative and the bundle grows a second copy of the
 *   same idea. `lib/**` must never see them at all — it has no DOM.
 * - `IMPORT_BOUNDARY_RULES` — one entrypoint must not pull in a module graph
 *   another entrypoint owns (2026-09-05). Same failure shape, first-party
 *   modules instead of packages.
 *
 * docs/25 Step 5 landed `sonner` in this file rather than in a second
 * `tests/snackbar-import-boundary.test.ts`: two files enforcing one rule is the
 * rule rotting in one of them. The import boundaries follow that precedent.
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

type ImportBoundaryRule = {
  /** Test name, also the failure label. */
  name: string;
  /** Repo-relative directory whose sources are scanned. */
  scope: string;
  /** Repo-relative module `scope` must not import. */
  forbidden: string;
  /**
   * `'self'` bans exactly that module (a barrel: `dir` and `dir/index`) while
   * leaving its leaf files reachable; `'subtree'` bans it and everything under.
   */
  reach: 'self' | 'subtree';
  /** Printed on failure so the fix needs no doc lookup. */
  why: string;
};

const IMPORT_BOUNDARY_RULES: ImportBoundaryRule[] = [
  {
    name: 'welcome imports app layout controls by leaf, never through the barrel',
    scope: 'entrypoints/welcome',
    forbidden: 'entrypoints/app/layouts/components',
    reach: 'self',
    why: 'the barrel re-exports settings-button -> components/settings -> storage, and welcome.html deliberately mounts no SettingsProvider. Import the leaf file (github-button / language-popover / theme-mode-button) instead.',
  },
  {
    name: 'welcome never reaches the settings context',
    scope: 'entrypoints/welcome',
    forbidden: 'entrypoints/app/components/settings',
    reach: 'subtree',
    why: 'welcome.html mounts no SettingsProvider, so useSettingsContext throws and the provider layer would ship in the welcome chunk for nothing.',
  },
];

/** Directories scanned for stray imports. */
const SCAN_DIRS = ['entrypoints', 'lib'];

const SOURCE_EXT = new Set(['.ts', '.tsx', '.css']);

/** Absolute path -> posix repo-relative path, the shape every failure prints. */
function repoRelative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

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
          offenders.push(repoRelative(file));
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

/** WXT aliases every one of these to the repo root (`.wxt/tsconfig.json`). */
const ALIAS_PREFIX = /^(?:@|~|@@|~~)\//;

const MODULE_EXT = /\.(?:tsx?|jsx?|css)$/;

/**
 * Import specifier -> repo-relative module path; `null` for bare packages
 * (those are `VENDOR_RULES` territory). Alias and relative forms both resolve,
 * so a future `../../app/...` cannot slip past a rule written against `@/`.
 */
function resolveSpecifier(fromFile: string, spec: string): string | null {
  let abs: string;
  if (ALIAS_PREFIX.test(spec)) {
    abs = path.resolve(ROOT, spec.slice(spec.indexOf('/') + 1));
  } else if (spec.startsWith('.')) {
    abs = path.resolve(path.dirname(fromFile), spec);
  } else {
    return null;
  }
  // `dir/index`, `dir/index.ts` and `dir` are the same module.
  return repoRelative(abs).replace(MODULE_EXT, '').replace(/\/index$/, '');
}

const SPECIFIER = /(?:from|import|require)\s*\(?\s*['"]([^'"]+)['"]/;

/**
 * Line-scanned so failures can name `file:line`. One specifier per line, which
 * is how every import in this repo is written; prose inside comments is not
 * stripped, same as `importsPackage` above.
 */
function importedModules(file: string): { line: number; module: string }[] {
  const found: { line: number; module: string }[] = [];
  readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .forEach((text, index) => {
      const match = SPECIFIER.exec(text);
      if (!match) return;
      const module = resolveSpecifier(file, match[1]);
      if (module) found.push({ line: index + 1, module });
    });
  return found;
}

describe('cross-entrypoint import boundaries', () => {
  it.each(IMPORT_BOUNDARY_RULES)('$name', ({ scope, forbidden, reach, why }) => {
    const offenders: string[] = [];

    for (const file of walk(path.resolve(ROOT, scope))) {
      for (const { line, module } of importedModules(file)) {
        const hit =
          reach === 'subtree' ? module === forbidden || module.startsWith(`${forbidden}/`) : module === forbidden;
        if (!hit) continue;
        offenders.push(`${repoRelative(file)}:${line} imports '${forbidden}' — ${why}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('welcome still consumes app layout controls by leaf file', () => {
    // The barrel rule above stays green on its own the day welcome stops
    // reusing these controls — at which point it guards nothing. Pin the
    // consumer so the rule has to keep meaning something.
    const leaves = walk(path.resolve(ROOT, 'entrypoints/welcome')).flatMap((file) =>
      importedModules(file)
        .map(({ module }) => module)
        .filter((module) => module.startsWith('entrypoints/app/layouts/components/')),
    );

    expect(leaves.length).toBeGreaterThan(0);
  });
});
