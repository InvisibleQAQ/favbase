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
import { SETTINGS_NAV } from '@/entrypoints/app/sections/settings/settings-nav';
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

/**
 * String-literal members of a union that sits in a *type* position, located by
 * the name of the declaration holding it — a type alias
 * (`type ConnSection = 'github' | …`) or a property signature
 * (`configSavedAt?: Partial<Record<'github' | …, number>>`). Descends to the
 * first union inside that type, so a union nested in type arguments is read
 * without hard-coding `Partial<Record<…>>`.
 * `undefined` when the declaration is absent or carries no union.
 */
function stringLiteralUnion(module: SourceModule, name: string): string[] | undefined {
  const type = (function findType(node: ts.Node): ts.TypeNode | undefined {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === name) return node.type;
    if (ts.isPropertySignature(node) && propertyName(node.name) === name) return node.type;
    return ts.forEachChild(node, findType);
  })(module.ast);
  if (!type) return undefined;

  const union = (function findUnion(node: ts.Node): ts.UnionTypeNode | undefined {
    if (ts.isUnionTypeNode(node)) return node;
    return ts.forEachChild(node, findUnion);
  })(type);
  if (!union) return undefined;

  return union.types.flatMap((member) =>
    ts.isLiteralTypeNode(member) && ts.isStringLiteralLike(member.literal)
      ? [member.literal.text]
      : [],
  );
}

/**
 * Names a module declares as *API*: function declarations plus the member
 * signatures of its interfaces and type literals. Variable declarations and
 * shorthand properties are excluded on purpose — `useSettings` also holds a
 * local `const saveGithub` and returns it as a shorthand property, so a
 * source-text or variable-level match would still find the name after the
 * `UseSettingsReturn` member that makes it callable had been deleted.
 */
function declaredApiNames(module: SourceModule): Set<string> {
  const names = new Set<string>();
  module.ast.forEachChild(function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) names.add(node.name.text);
    if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
      const name = propertyName(node.name);
      if (name) names.add(name);
    }
    node.forEachChild(visit);
  });
  return names;
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
    // (or Creator, or platform_meta) axis the ranked list never renders is a
    // dimension the Dashboard breakdown card silently leaves empty — the query
    // runs, the rows are grouped, and nothing ever asks for them.
    for (const platform of COLLECTION_PLATFORMS) {
      const { ranked, author, source, meta }: PlatformDimensions =
        PLATFORM_DESCRIPTORS[platform].dimensions;
      if (!ranked.includes(author)) {
        missing.push(`${platform}: author dimension '${author}' is absent from the ranked list`);
      }
      if (source !== null && !ranked.includes(source)) {
        missing.push(`${platform}: source dimension '${source}' is absent from the ranked list`);
      }
      if (meta !== null && !ranked.includes(meta.kind)) {
        missing.push(`${platform}: meta dimension '${meta.kind}' is absent from the ranked list`);
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

    // The credentials chain (spec §8). `readiness: 'credentials'` promises a
    // person somewhere to type a key in; the edits that keep that promise are
    // a schema key, two hook declarations, a Connections section and a React
    // card — structure, not data, so no *platform* descriptor field can hold
    // them (ADR 0004). Not-data is why the rest are read by AST here, exactly
    // as CARD_ADAPTERS is; it was never a reason to leave them unchecked.
    //
    // The section itself is the exception: it is plain data in `SETTINGS_NAV`
    // (the settings two-level route registry), which has no value imports, so
    // it is read by importing it rather than by parsing the view. That table
    // replaced the two hand-written lists this check used to parse — a
    // `ConnSection` union and a `connNavItems` array — and `tsc` now catches
    // *half* of a removal on its own, because `SettingsLeaf` is derived from
    // it and the view's switch is exhaustive. The half left is deleting the
    // section and its case together, which silently strands the card.
    //
    // LIMIT: this proves the structure *exists*, not that it is wired
    // correctly. A card that renders while the Sync Adapter's `probeReady`
    // reads the wrong settings key — or a zod entry that drops the field on
    // load — passes every line below. Spec §8 still has to be read by hand.
    //
    // One-directional on purpose: platform ⊆ Connections sections. That tab
    // also carries 'agent-bridge', which is neither a platform nor a
    // Collection Item holder (CONTEXT.md), so the reverse is not a defect.
    const connSections = SETTINGS_NAV.find((entry) => entry.tab === 'connections')
      ?.sections.map((section) => section.id);
    const settingsApi = declaredApiNames(sourceModule('lib/hooks/useSettings.ts'));
    const savedAtSections = stringLiteralUnion(
      sourceModule('lib/storage/settings-schema.ts'),
      'configSavedAt',
    );
    if (!connSections) missing.push('all: SETTINGS_NAV has no connections tab');
    if (!savedAtSections) missing.push('all: configSavedAt carries no string-literal union');
    for (const platform of COLLECTION_PLATFORMS) {
      if (PLATFORM_DESCRIPTORS[platform].readiness !== 'credentials') continue;
      const pascal = platform
        .split('-')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
      const card = `entrypoints/app/sections/settings/${platform}-connection-card.tsx`;
      if (!existsSync(path.join(ROOT, card))) {
        missing.push(`${platform}: Connections card (${card})`);
      }
      if (connSections && !connSections.some((id) => id === platform)) {
        missing.push(`${platform}: SETTINGS_NAV connections section`);
      }
      for (const declaration of [`derive${pascal}Draft`, `save${pascal}`]) {
        if (!settingsApi.has(declaration)) missing.push(`${platform}: useSettings ${declaration}`);
      }
      if (savedAtSections && !savedAtSections.includes(platform)) {
        missing.push(`${platform}: configSavedAt key`);
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
    // composes an exhaustive per-platform registry (null = no exclusion). That
    // the policy itself never names a platform or a platform_meta key is now
    // one of the shared modules checked by the separate case below.
    collectRegistryCoverage(
      missing,
      'downstream eligibility predicate',
      'lib/collections/platform-eligibility.ts',
      'PLATFORM_DOWNSTREAM_ELIGIBILITY',
    );

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

  it('dispatches the post-sync processing lanes only through the Platform Sync funnel', () => {
    // A Platform Sync's closing embed/tag dispatch is the funnel's job
    // (docs/32 Step 1): it runs only after the sync succeeded and before the
    // Platform Sync Record says so. An adapter calling the dispatcher itself
    // skips the record — the exact defect that let failed and empty syncs
    // leave no trace. Per-item streaming paths use
    // `enqueueCollectionProcessingItem`, which this rule does not touch.
    const offenders: string[] = [];
    for (const file of appModules()) {
      if (DISPATCH_OWNERS.has(file)) continue;
      const { ast } = sourceModule(file);
      ast.forEachChild(function visit(node) {
        if (ts.isIdentifier(node) && node.text === 'startCollectionProcessingJobs') {
          const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
          offenders.push(`${file}:${line + 1}`);
        }
        node.forEachChild(visit);
      });
    }

    expect(
      offenders,
      `startCollectionProcessingJobs outside ${[...DISPATCH_OWNERS].join(' / ')}:\n`
        + offenders.map((item) => `- ${item}`).join('\n'),
    ).toEqual([]);
  });

  it('keeps platform knowledge out of shared modules', () => {
    // Shared modules serve every platform, so a platform rule written into one
    // of them is invisible to the next platform that should have it — the
    // tagging prompt read Bilibili's `intro` and nothing else, so a GitHub
    // repository's description never reached it (docs/32 中-4). Platform facts
    // are descriptor data (`lib/collections/platform-descriptor.ts`); a shared
    // module reads them by variable, never by literal.
    //
    // Read by AST, not by source text: `import.meta.env` (a `MetaProperty`) and
    // a comment naming `bilibili` in backticks are not offences, and only the
    // syntax tree tells them apart from `meta.intro` and `'github'`.
    const offenders = new Set<string>();
    for (const file of sharedModules()) {
      const { ast } = sourceModule(file);
      const report = (position: number, reason: string) => {
        const { line } = ast.getLineAndCharacterOfPosition(position);
        offenders.add(`${file}:${line + 1}: ${reason}`);
      };
      ast.forEachChild(function visit(node) {
        // 1. A quoted platform id: a string literal that *is* one, or one
        //    quoted inside SQL text (`= 'github'` sits in a template part).
        const moduleSpecifier =
          ts.isImportDeclaration(node.parent) || ts.isExportDeclaration(node.parent);
        if (ts.isStringLiteral(node) && PLATFORM_IDS.has(node.text)) {
          report(node.getStart(ast), `platform literal '${node.text}'`);
        } else if (isLiteralText(node) && !moduleSpecifier) {
          // `getText` includes the leading quote / backtick / `}`, so a match
          // offset lands on the line the match is really on.
          const text = node.getText(ast);
          for (const match of text.matchAll(QUOTED_PLATFORM)) {
            report(node.getStart(ast) + match.index, `platform literal '${match[2]}' in SQL text`);
          }
          // 3. A JSON path with a literal key (`->`, `->>`, `#>`, `#>>`).
          //    `->>${field}` ends the text part at `->>`, so a parameterized
          //    key never matches.
          for (const match of text.matchAll(LITERAL_JSON_KEY)) {
            report(node.getStart(ast) + match.index, `literal JSON key ${match[0]}`);
          }
        }
        // 2. A literal key read off platform meta. Whole-column references
        //    (`items.platformMeta`) name `platformMeta` as the *property*, not
        //    the object, and a variable subscript (`meta[field]`) is the fix.
        if (ts.isPropertyAccessExpression(node) && isMetaObject(node.expression)) {
          report(node.getStart(ast), `literal meta key ${node.getText(ast)}`);
        }
        if (
          ts.isElementAccessExpression(node)
          && isMetaObject(node.expression)
          && ts.isStringLiteralLike(node.argumentExpression)
        ) {
          report(node.getStart(ast), `literal meta key ${node.getText(ast)}`);
        }
        // `const { intro } = meta` is `meta.intro` spelled as a pattern. A
        // rest element or a computed key (`{ [field]: value }`) names no key.
        if (
          ts.isVariableDeclaration(node)
          && ts.isObjectBindingPattern(node.name)
          && node.initializer
          && isMetaObject(node.initializer)
          && node.name.elements.some(
            (element) =>
              !element.dotDotDotToken
              && !(element.propertyName && ts.isComputedPropertyName(element.propertyName)),
          )
        ) {
          report(node.getStart(ast), `literal meta key ${node.getText(ast)}`);
        }
        node.forEachChild(visit);
      });
    }

    expect(
      [...offenders],
      `Platform knowledge in a shared module (move it into the Platform Descriptor):\n`
        + [...offenders].map((item) => `- ${item}`).join('\n')
        + '\n(The meta check is name-based: a local called `meta` / `platformMeta`, or a'
        + ' `.platformMeta` column, is read as platform_meta. If a flagged `meta` local'
        + ' holds descriptor data instead, rename it.)',
    ).toEqual([]);
  });

  it('detects platform error classes that skip the shared bases', () => {
    // Self-check (docs/32 Step 4): the inheritance rule below must actually
    // catch a class that extends `Error` or nothing — declared or assigned as
    // a class expression — and must not flag a class whose name is outside its
    // two suffixes.
    const offending = [
      'class FooAuthError extends Error {}',
      'class FooRateLimitError extends Error {}',
      'class FooAuthError {}',
      'export default class FooAuthError extends Error {}',
      'class FooAuthError extends globalThis.Error {}',
      'const FooAuthError = class extends Error {};',
      'const FooRateLimitError = (class Inner extends Error {});',
      'let FooAuthError; FooAuthError = class extends Error {};',
    ];
    for (const source of offending) {
      expect(platformErrorBaseOffenders(source), source).toHaveLength(1);
    }

    const passing = [
      'class FooAuthError extends PlatformAuthError {}',
      'class FooRateLimitError extends PlatformRateLimitError {}',
      'const FooAuthError = class extends PlatformAuthError {};',
      'class HttpDeadlineError extends Error {}',
      'const HttpDeadlineError = class extends Error {};',
    ];
    for (const source of passing) {
      expect(platformErrorBaseOffenders(source), source).toEqual([]);
    }
  });

  it('derives every platform auth / rate-limit error from the shared bases', () => {
    // The app classifies a sync failure by the base class alone
    // (`classifyCollectionSyncError`), so a platform error that extends
    // `Error` directly is silently shown as an unknown failure — raw English
    // debug text instead of the platform's localized auth / rate-limit copy.
    const offenders: string[] = [];
    for (const dir of PLATFORM_DIRS) {
      for (const file of platformSourceFiles(dir)) {
        for (const { line, text } of platformErrorBaseOffenders(sourceModule(file).source, file)) {
          offenders.push(`${file}:${line}: ${text}`);
        }
      }
    }

    expect(
      offenders,
      'Platform error class not derived from lib/collections/sync-errors.ts — make every'
        + ' `*AuthError` extend `PlatformAuthError` and every `*RateLimitError` extend'
        + ' `PlatformRateLimitError` (the `reason` rule is in that file\'s doc comment):\n'
        + offenders.map((item) => `- ${item}`).join('\n'),
    ).toEqual([]);
  });
});

/** Class-name suffix → the base in `lib/collections/sync-errors.ts` it must extend. */
const PLATFORM_ERROR_BASES: ReadonlyArray<{ suffix: RegExp; base: string }> = [
  { suffix: /AuthError$/, base: 'PlatformAuthError' },
  { suffix: /RateLimitError$/, base: 'PlatformRateLimitError' },
];

/**
 * Every class — declaration or expression — named `*AuthError` /
 * `*RateLimitError` whose `extends` clause is not exactly the matching base
 * identifier. The base is matched by name, deliberately strict: an alias
 * (`const Base = PlatformAuthError; … extends Base`) or a wrapped base
 * (`extends (PlatformAuthError as …)`) is flagged too — write the base itself.
 */
function platformErrorBaseOffenders(
  source: string,
  fileName = 'probe.ts',
): Array<{ line: number; text: string }> {
  const ast = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const offenders: Array<{ line: number; text: string }> = [];
  ast.forEachChild(function visit(node) {
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const match = errorClassNames(node)
        .map((name) => ({ name, rule: PLATFORM_ERROR_BASES.find(({ suffix }) => suffix.test(name)) }))
        .find(({ rule }) => rule !== undefined);
      const heritage = node.heritageClauses
        ?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
        ?.types[0]?.expression;
      if (
        match?.rule
        && !(heritage && ts.isIdentifier(heritage) && heritage.text === match.rule.base)
      ) {
        const { line } = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        offenders.push({
          line: line + 1,
          text: `${match.name} extends ${heritage ? heritage.getText(ast) : 'nothing'}`,
        });
      }
    }
    node.forEachChild(visit);
  });
  return offenders;
}

/**
 * The names a class goes by: its own, plus — for a class expression — the
 * binding it is assigned to (`const X = class …`, `X = class …`,
 * `{ X: class … }`), looking through parentheses and type assertions. An
 * anonymous class nobody names (`export default class extends Error {}`) has
 * none and is not checked.
 */
function errorClassNames(node: ts.ClassDeclaration | ts.ClassExpression): string[] {
  const names = node.name ? [node.name.text] : [];
  if (!ts.isClassExpression(node)) return names;
  let parent = node.parent;
  while (
    ts.isParenthesizedExpression(parent)
    || ts.isAsExpression(parent)
    || ts.isSatisfiesExpression(parent)
    || ts.isTypeAssertionExpression(parent)
    || ts.isNonNullExpression(parent)
  ) {
    parent = parent.parent;
  }
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    names.push(parent.name.text);
  } else if (
    ts.isBinaryExpression(parent)
    && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && (ts.isIdentifier(parent.left) || ts.isPropertyAccessExpression(parent.left))
  ) {
    names.push(ts.isIdentifier(parent.left) ? parent.left.text : parent.left.name.text);
  } else if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    names.push(parent.name.text);
  }
  return names;
}

/** Every non-test `.ts` module under a platform directory, repo-relative. */
function platformSourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return platformSourceFiles(relative);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [relative] : [];
  });
}

const PLATFORM_IDS = new Set<string>(COLLECTION_PLATFORMS);
const QUOTED_PLATFORM = new RegExp(`(['"])(${COLLECTION_PLATFORMS.join('|')})\\1`, 'g');
const LITERAL_JSON_KEY = /(?:->|#>)>?\s*'[^']*'/g;

/**
 * Modules every platform flows through. Whole directories are listed so a new
 * file in one is checked without editing this table. `lib/collections/**` is
 * deliberately *not* one of them: `platforms.ts`, `platform-descriptor.ts` and
 * `platform-eligibility.ts` are the registries, and naming platforms is their
 * job. `collections-query.ts` is the counter-example kept in on purpose — it
 * reads meta by a descriptor-supplied key (`->>${sortKey.field}`), which is the
 * shape this rule asks for, and it has to stay green.
 */
const SHARED_MODULE_DIRECTORIES = ['lib/tagging', 'lib/embedding', 'lib/chat', 'lib/export'];
const SHARED_MODULE_FILES = [
  'lib/collections/collection-analytics.ts',
  'lib/collections/collection-processing-policy.ts',
  'lib/collections/collections-query.ts',
];

function sharedModules(): string[] {
  const walk = (directory: string): string[] =>
    readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return walk(relative);
      return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [relative] : [];
    });
  return [...SHARED_MODULE_DIRECTORIES.flatMap(walk), ...SHARED_MODULE_FILES];
}

function isLiteralText(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
  );
}

/**
 * `meta` / `platformMeta` as a variable, or `<row>.platformMeta` as a column —
 * also behind the `(meta ?? {})` fallback this codebase narrows with. By name
 * only: an alias (`const m = row.platformMeta; m.intro`) is not followed.
 */
function isMetaObject(expression: ts.Expression): boolean {
  const target = unwrap(expression);
  if (
    ts.isBinaryExpression(target)
    && (target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      || target.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return isMetaObject(target.left);
  }
  if (ts.isIdentifier(target)) return /^(meta|platformMeta)$/.test(target.text);
  return ts.isPropertyAccessExpression(target) && target.name.text === 'platformMeta';
}

/** The dispatcher's definition and the Platform Sync funnel — nothing else. */
const DISPATCH_OWNERS = new Set([
  `${HOOKS_DIR}/collection-processing-jobs.ts`,
  `${HOOKS_DIR}/platform-sync.ts`,
]);

/** Every non-test `.ts`/`.tsx` module under `entrypoints/app`, repo-relative. */
function appModules(directory = 'entrypoints/app'): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return appModules(relative);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative] : [];
  });
}
