import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  COLLECTION_PLATFORMS,
  type CollectionPlatform,
} from '@/lib/collections/platforms';
import {
  PLATFORM_DESCRIPTORS,
  type PlatformDimensions,
} from '@/lib/collections/platform-descriptor';
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

/**
 * String values of one field across an array literal of object literals — e.g.
 * every `labelKey` in `const ROW_TOP: Pill[] = [{ labelKey: '…' }, …]`.
 * `undefined` when the binding is missing or is not an array literal.
 */
function arrayFieldValues(
  module: SourceModule,
  name: string,
  field: string,
): string[] | undefined {
  const initializer = variableInitializer(module, name);
  if (!initializer) return undefined;
  const array = unwrap(initializer);
  if (!ts.isArrayLiteralExpression(array)) return undefined;

  const values: string[] = [];
  for (const element of array.elements) {
    const object = unwrap(element);
    if (!ts.isObjectLiteralExpression(object)) continue;
    for (const property of object.properties) {
      if (!ts.isPropertyAssignment(property) || !property.name) continue;
      if (propertyName(property.name) !== field) continue;
      const value = stringValue(unwrap(property.initializer));
      if (value) values.push(value);
    }
  }
  return values;
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

/**
 * Parse a registry this contract needs to *read* — to join two registries, or
 * to check the shape of a value — without re-asserting per-platform coverage.
 * Both Platform Descriptors are exhaustive `Record`s, so a missing or stale
 * platform is a compile error on the object literal that names the platform;
 * reading it a second time by AST would be the same rule in two places.
 */
function readRegistry(
  missing: string[],
  label: string,
  relativeFile: string,
  variable: string,
): ObjectRegistry | undefined {
  if (!existsSync(path.join(ROOT, relativeFile))) {
    missing.push(`all: ${label} file missing (${relativeFile})`);
    return undefined;
  }
  const registry = objectRegistry(relativeFile, variable);
  if (!registry) missing.push(`all: ${label} (${variable}) is not an object literal`);
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

/**
 * The section view a lazy page renders. Pages are one-line re-exports, so the
 * single `../sections/…` import is the view module.
 */
function resolveViewModule(pageFile: string): string | undefined {
  const specifier = readFileSync(pageFile, 'utf8').match(
    /from\s+['"](\.\.\/sections\/[^'"]+)['"]/,
  )?.[1];
  if (!specifier) return undefined;
  const base = path.join(path.dirname(pageFile), specifier);
  for (const candidate of [`${base}.tsx`, `${base}.ts`, base]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

describe('platform completeness contract', () => {
  it('reports every missing platform Adapter in one failure', () => {
    const missing: string[] = [];

    const navMeta = readRegistry(
      missing,
      'app Platform Descriptor',
      'entrypoints/app/collection-platform-registry.ts',
      'PLATFORM_META',
    );
    const descriptors = readRegistry(
      missing,
      'domain Platform Descriptor',
      'lib/collections/platform-descriptor.ts',
      'PLATFORM_DESCRIPTORS',
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

    // The three analytics dimension tables are one `dimensions` object now, so
    // the pair that used to be impossible to cross-check is checkable: a Source
    // (or Creator) axis the ranked list never renders is a dimension the
    // Dashboard breakdown card silently leaves empty.
    for (const platform of COLLECTION_PLATFORMS) {
      const { ranked, author, source }: PlatformDimensions =
        PLATFORM_DESCRIPTORS[platform].dimensions;
      if (!ranked.includes(author)) {
        missing.push(`${platform}: author dimension '${author}' is absent from the ranked list`);
      }
      if (source !== null && !ranked.includes(source)) {
        missing.push(`${platform}: source dimension '${source}' is absent from the ranked list`);
      }
    }

    // The welcome capability marquee is hand-authored on purpose: the pill
    // rhythm (platforms leading the top row, capabilities trailing the bottom)
    // is a design decision, not a derivation (docs/26 D5). Coverage still is a
    // platform fact — an unlisted platform is silently absent from the
    // product's first screen. Read by AST: the rows are module-private and the
    // module pulls MUI + Iconify + motion, which this contract never loads.
    const marquee = sourceModule('entrypoints/welcome/sections/capability-marquee.tsx');
    const marqueeRows = ['ROW_TOP', 'ROW_BOTTOM'].map(
      (row) => [row, arrayFieldValues(marquee, row, 'labelKey')] as const,
    );
    const pillLabelKeys = new Set<string>();
    for (const [row, labelKeys] of marqueeRows) {
      if (!labelKeys) {
        missing.push(`all: welcome marquee ${row} is not an explicit array literal`);
        continue;
      }
      for (const labelKey of labelKeys) pillLabelKeys.add(labelKey);
    }
    if (navMeta && marqueeRows.every(([, labelKeys]) => labelKeys)) {
      for (const platform of COLLECTION_PLATFORMS) {
        const title = stringValue(propertyValue(navMeta, platform, 'title'));
        // A missing title is a compile error on the exhaustive `PLATFORM_META`,
        // so it is not reported a second time here.
        if (title && !pillLabelKeys.has(title)) {
          missing.push(`${platform}: welcome capability marquee pill`);
        }
      }
    }
    const autoSync = collectRegistryCoverage(
      missing,
      'daily auto-sync Adapter',
      'entrypoints/app/collection-platform-auto-sync.ts',
      'AUTO_SYNC_PLATFORM_BY_COLLECTION',
    );
    // Two descriptor fields must stay explicit array literals rather than
    // anything computed: detail child routes (the router's shape) and host
    // permissions (the manifest's). A value assembled from a helper hides a
    // platform's real surface from review and, for the manifest, from the
    // re-authorization prompt an installed extension shows the user.
    for (const [label, registry, field] of [
      ['page child-route list', navMeta, 'childRoutes'],
      ['host-permission list', descriptors, 'hostPermissions'],
    ] as const) {
      if (!registry) continue;
      for (const platform of COLLECTION_PLATFORMS) {
        const value = propertyValue(registry, platform, field);
        if (!value || !ts.isArrayLiteralExpression(value)) {
          missing.push(`${platform}: ${label} is not explicit`);
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
        const pageFile = importPath ? resolveImportedPage(importPath) : undefined;
        const viewFile = pageFile ? resolveViewModule(pageFile) : undefined;
        if (!importPath) {
          missing.push(`${platform}: lazy page import`);
        } else if (!pageFile) {
          missing.push(`${platform}: lazy page module does not exist (${importPath})`);
        } else if (!viewFile) {
          missing.push(`${platform}: lazy page does not render a sections/ view`);
        } else if (!readFileSync(viewFile, 'utf8').includes('useCollectionBreadcrumbs(')) {
          // Every collection route sits under Home > Collections. The trail is
          // derived from the navigation registry, so a new platform gets it by
          // calling the shared hook — never by hand-writing crumbs.
          missing.push(`${platform}: collection page ancestry (useCollectionBreadcrumbs)`);
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
