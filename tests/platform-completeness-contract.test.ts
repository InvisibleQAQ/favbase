import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  COLLECTION_PLATFORMS,
  type CollectionPlatform,
} from '@/lib/collections/platforms';
import { jobPlatformForCollection } from '@/entrypoints/app/hooks/collection-job-platform';
import { PLATFORM_DIRS, PLATFORM_KEY_LINE } from './platform-env-guard-contract';

const ROOT = path.resolve(__dirname, '..');

interface SourceModule {
  file: string;
  source: string;
  ast: ts.SourceFile;
}

interface ObjectRegistry {
  source: SourceModule;
  properties: Map<string, ts.PropertyAssignment>;
}

const sourceCache = new Map<string, SourceModule>();

function sourceModule(relativeFile: string): SourceModule {
  const cached = sourceCache.get(relativeFile);
  if (cached) return cached;

  const file = path.join(ROOT, relativeFile);
  const source = readFileSync(file, 'utf8');
  const ast = ts.createSourceFile(relativeFile, source, ts.ScriptTarget.Latest, true);
  const module = { file, source, ast };
  sourceCache.set(relativeFile, module);
  return module;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current)
    || ts.isParenthesizedExpression(current)
    || ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function variableInitializer(
  module: SourceModule,
  name: string,
): ts.Expression | undefined {
  let initializer: ts.Expression | undefined;
  module.ast.forEachChild(function visit(node) {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === name
      && node.initializer
    ) {
      initializer = node.initializer;
    }
    if (!initializer) node.forEachChild(visit);
  });
  return initializer;
}

function propertyName(property: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(property) || ts.isStringLiteralLike(property)) return property.text;
  return undefined;
}

function objectRegistry(relativeFile: string, name: string): ObjectRegistry | undefined {
  const source = sourceModule(relativeFile);
  const initializer = variableInitializer(source, name);
  if (!initializer) return undefined;
  const object = unwrap(initializer);
  if (!ts.isObjectLiteralExpression(object)) return undefined;

  const properties = new Map<string, ts.PropertyAssignment>();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !property.name) continue;
    const key = propertyName(property.name);
    if (key) properties.set(key, property);
  }
  return { source, properties };
}

function propertyValue(
  registry: ObjectRegistry,
  platform: string,
  field: string,
): ts.Expression | undefined {
  const property = registry.properties.get(platform);
  if (!property) return undefined;
  const object = unwrap(property.initializer);
  if (!ts.isObjectLiteralExpression(object)) return undefined;
  const fieldProperty = object.properties.find(
    (candidate): candidate is ts.PropertyAssignment =>
      ts.isPropertyAssignment(candidate)
      && !!candidate.name
      && propertyName(candidate.name) === field,
  );
  return fieldProperty ? unwrap(fieldProperty.initializer) : undefined;
}

function stringValue(expression: ts.Expression | undefined): string | undefined {
  return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
}

function isExplicitUndefined(expression: ts.Expression | undefined): boolean {
  return !!expression && ts.isIdentifier(expression) && expression.text === 'undefined';
}

function collectRegistryCoverage(
  missing: string[],
  label: string,
  relativeFile: string,
  variable: string,
): ObjectRegistry | undefined {
  if (!existsSync(path.join(ROOT, relativeFile))) {
    for (const platform of COLLECTION_PLATFORMS) {
      missing.push(`${platform}: ${label} registry file missing (${relativeFile})`);
    }
    return undefined;
  }
  const registry = objectRegistry(relativeFile, variable);
  if (!registry) {
    for (const platform of COLLECTION_PLATFORMS) {
      missing.push(`${platform}: ${label} registry missing or malformed`);
    }
    return undefined;
  }

  const supported = new Set<string>(COLLECTION_PLATFORMS);
  for (const platform of COLLECTION_PLATFORMS) {
    const initializer = registry.properties.get(platform)?.initializer;
    if (!initializer || isExplicitUndefined(initializer)) missing.push(`${platform}: ${label}`);
  }
  for (const platform of registry.properties.keys()) {
    if (!supported.has(platform)) missing.push(`${platform}: stale ${label}`);
  }
  return registry;
}

function hasIdentifierSpread(module: SourceModule, identifier: string): boolean {
  let found = false;
  module.ast.forEachChild(function visit(node) {
    if (
      ts.isSpreadElement(node)
      && node.expression.getText(module.ast).includes(identifier)
    ) {
      found = true;
    }
    if (!found) node.forEachChild(visit);
  });
  return found;
}

function hasArrayPropertySpread(
  module: SourceModule,
  property: string,
  identifier: string,
): boolean {
  let found = false;
  module.ast.forEachChild(function visit(node) {
    if (
      ts.isPropertyAssignment(node)
      && !!node.name
      && propertyName(node.name) === property
    ) {
      const value = unwrap(node.initializer);
      if (
        ts.isArrayLiteralExpression(value)
        && value.elements.some(
          (element) =>
            ts.isSpreadElement(element)
            && ts.isIdentifier(element.expression)
            && element.expression.text === identifier,
        )
      ) {
        found = true;
      }
    }
    if (!found) node.forEachChild(visit);
  });
  return found;
}

const HOOKS_DIR = 'entrypoints/app/hooks';

/** Non-test hook modules, as repo-relative paths. */
function hookModules(): string[] {
  return readdirSync(path.join(ROOT, HOOKS_DIR))
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => `${HOOKS_DIR}/${name}`);
}

function resolveImportedPage(relativeImport: string): string | undefined {
  const base = path.join(ROOT, 'entrypoints/app', relativeImport);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

describe('platform completeness contract', () => {
  it('reports every missing platform Adapter in one failure', () => {
    const missing: string[] = [];

    collectRegistryCoverage(
      missing,
      'navigation metadata',
      'entrypoints/app/collection-platform-registry.ts',
      'PLATFORM_META',
    );
    const pageLoaders = collectRegistryCoverage(
      missing,
      'lazy page loader',
      'entrypoints/app/collection-platform-pages.ts',
      'COLLECTION_PAGE_LOADERS',
    );
    collectRegistryCoverage(
      missing,
      'Collection Item card Adapter',
      'entrypoints/app/sections/collections/collection-item-card.tsx',
      'CARD_ADAPTERS',
    );
    collectRegistryCoverage(
      missing,
      'Collection Analytics dimensions',
      'lib/collections/collection-analytics.ts',
      'PLATFORM_DIMENSIONS',
    );
    collectRegistryCoverage(
      missing,
      'Collection Analytics author dimension',
      'lib/collections/collection-analytics.ts',
      'AUTHOR_DIMENSION',
    );
    const jobMap = collectRegistryCoverage(
      missing,
      'background-job namespace',
      'entrypoints/app/hooks/collection-job-platform.ts',
      'JOB_PLATFORM_BY_COLLECTION',
    );
    collectRegistryCoverage(
      missing,
      'welcome readiness policy',
      'entrypoints/welcome/landing.ts',
      'WELCOME_READINESS_BY_PLATFORM',
    );
    const autoSync = collectRegistryCoverage(
      missing,
      'daily auto-sync Adapter',
      'entrypoints/app/collection-platform-auto-sync.ts',
      'AUTO_SYNC_PLATFORM_BY_COLLECTION',
    );
    const hostPermissions = collectRegistryCoverage(
      missing,
      'host-permission declaration',
      'wxt.config.ts',
      'PLATFORM_HOST_PERMISSIONS',
    );
    // Brand identity color: the six-key tables in palette.ts are explicit (no spread)
    // so black-logo brands that intentionally map to ink are still declared per key.
    collectRegistryCoverage(
      missing,
      'platform brand palette (light)',
      'entrypoints/app/theme/core/palette.ts',
      'PLATFORM_PALETTE_LIGHT',
    );
    collectRegistryCoverage(
      missing,
      'platform brand palette (dark)',
      'entrypoints/app/theme/core/palette.ts',
      'PLATFORM_PALETTE_DARK',
    );

    // Child param segments (detail routes) are a platform fact too: every platform
    // declares an explicit list (possibly empty) and main.tsx never names a platform.
    const childRoutes = collectRegistryCoverage(
      missing,
      'page child routes',
      'entrypoints/app/collection-platform-pages.ts',
      'COLLECTION_PAGE_CHILD_ROUTES',
    );
    if (childRoutes) {
      for (const platform of COLLECTION_PLATFORMS) {
        const value = childRoutes.properties.get(platform)?.initializer;
        if (!value || !ts.isArrayLiteralExpression(unwrap(value))) {
          missing.push(`${platform}: page child-route list is not explicit`);
        }
      }
    }

    if (pageLoaders) {
      const main = sourceModule('entrypoints/app/main.tsx');
      if (!hasIdentifierSpread(main, 'collectionPlatformRoutes')) {
        missing.push('all: main route registry spread');
      }
      if (new RegExp(`collections/(${COLLECTION_PLATFORMS.join('|')})`).test(main.source)) {
        missing.push('all: main.tsx still declares a platform-specific route');
      }
      if (!pageLoaders.source.source.includes('path: `collections/${platform}`')) {
        missing.push('all: collection route path is not derived from the platform id');
      }
      for (const platform of COLLECTION_PLATFORMS) {
        const initializer = pageLoaders.properties.get(platform)?.initializer;
        const importPath = initializer
          ?.getText(pageLoaders.source.ast)
          .match(/import\(\s*['"](.+?)['"]\s*\)/)?.[1];
        if (!importPath) {
          missing.push(`${platform}: lazy page import`);
        } else if (!resolveImportedPage(importPath)) {
          missing.push(`${platform}: lazy page module does not exist (${importPath})`);
        }
      }
    }

    if (jobMap) {
      for (const platform of COLLECTION_PLATFORMS) {
        const actual = stringValue(jobMap.properties.get(platform)?.initializer);
        if (actual !== jobPlatformForCollection(platform)) {
          missing.push(`${platform}: background-job namespace value`);
        }
      }
    }

    if (autoSync) {
      for (const platform of COLLECTION_PLATFORMS) {
        if (!propertyValue(autoSync, platform, 'runSync')) {
          missing.push(`${platform}: auto-sync runSync`);
        }
        // The job namespace is derived from the Collection discriminator via
        // jobPlatformForCollection — a second hand-written copy is the defect.
        if (propertyValue(autoSync, platform, 'jobPlatform')) {
          missing.push(`${platform}: auto-sync job namespace is hand-written`);
        }
      }
    }

    // Global hooks never reverse-import a UI section: the per-platform Sync
    // Adapters are aggregated at the app root (collection-platform-*.ts), and
    // the coordinator hook receives that registry by injection.
    for (const file of hookModules()) {
      if (/(?:from|import\()\s*['"][^'"]*sections\//.test(sourceModule(file).source)) {
        missing.push(`all: ${file} imports sections/`);
      }
    }

    const wxt = sourceModule('wxt.config.ts');
    if (!hasArrayPropertySpread(wxt, 'host_permissions', 'PLATFORM_HOST_PERMISSION_LIST')) {
      missing.push('all: platform host-permission list not spread into manifest');
    }
    if (hostPermissions) {
      for (const platform of COLLECTION_PLATFORMS) {
        const value = hostPermissions.properties.get(platform)?.initializer;
        if (!value || !ts.isArrayLiteralExpression(unwrap(value))) {
          missing.push(`${platform}: host-permission list is not explicit`);
        }
      }
    }

    // Downstream eligibility is a platform fact: the shared processing policy
    // composes an exhaustive per-platform registry (null = no exclusion) and
    // never names a platform or a platform_meta field itself.
    collectRegistryCoverage(
      missing,
      'downstream eligibility predicate',
      'lib/collections/platform-eligibility.ts',
      'PLATFORM_DOWNSTREAM_ELIGIBILITY',
    );
    const policy = sourceModule('lib/collections/collection-processing-policy.ts');
    if (
      new RegExp(`['"](${COLLECTION_PLATFORMS.join('|')})['"]`).test(policy.source)
      || /platformMeta|->>/.test(policy.source)
    ) {
      missing.push('all: collection-processing-policy.ts encodes a platform rule');
    }

    const envDirectories = new Set(PLATFORM_DIRS);
    for (const platform of COLLECTION_PLATFORMS) {
      const directory = `lib/${platform}`;
      if (!envDirectories.has(directory)) missing.push(`${platform}: env guard directory scan`);
      if (!existsSync(path.join(ROOT, directory))) {
        missing.push(`${platform}: env guard directory does not exist (${directory})`);
      }
      const probeKey = `VITE_${platform.toUpperCase()}_CONTRACT_PROBE=`;
      if (!PLATFORM_KEY_LINE.test(probeKey)) missing.push(`${platform}: env orphan-key prefix`);
    }

    expect(
      missing,
      `Platform completeness contract failed:\n${missing.map((item) => `- ${item}`).join('\n')}`,
    ).toEqual([]);
  });
});
