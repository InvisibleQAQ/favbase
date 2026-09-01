import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BACKGROUND_GRAPH_BYTES = 2 * 1024 * 1024;
const PGLITE_MARKERS = [
  'pglite.wasm',
  'Postgres tried to execute',
  'PGlite.create',
  'DatabaseRpcHandler',
];
const DANGLING_INITIALIZER_MARKERS = ['init_locales'];
/**
 * A dynamic `import(`, capturing the specifier when it is a string literal in
 * any of the three quote forms the bundler emits (single, double, backtick).
 * The capture is optional on purpose: a computed specifier (`import(url)`,
 * `import(__variableDynamicImportRuntime0(x))`) is still a dynamic import the
 * Service Worker cannot run, and is precisely the case the graph walker cannot
 * follow — see `findDynamicImports`.
 *
 * Built fresh per call: a shared `/g` regex carries `lastIndex` across
 * `matchAll`/`exec` callers and would silently skip matches.
 */
function dynamicImportPattern() {
  return /\bimport\s*\(\s*(?:[`'"]([^`'"]+)[`'"]\s*\))?/g;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.join(root, '.output', 'chrome-mv3');
const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
const serviceWorker = manifest.background?.service_worker;

if (typeof serviceWorker !== 'string' || serviceWorker.length === 0) {
  throw new Error('Chrome MV3 manifest has no background service worker');
}
if (manifest.background?.type !== 'module') {
  throw new Error('Chrome MV3 background service worker must be an ES module');
}

const backgroundPath = path.join(outputDir, serviceWorker);
const modules = await readModuleGraph(backgroundPath);
const size = [...modules.values()].reduce(
  (total, source) => total + Buffer.byteLength(source),
  0,
);

if (size > MAX_BACKGROUND_GRAPH_BYTES) {
  throw new Error(
    `Background module graph is ${size} bytes; limit is ${MAX_BACKGROUND_GRAPH_BYTES}. ` +
      'Check for a heavy transitive dependency.',
  );
}

const foundMarkers = findMarkers(modules, PGLITE_MARKERS);
if (foundMarkers.length > 0) {
  throw new Error(`Background module graph contains PGlite markers: ${foundMarkers.join(', ')}`);
}

const danglingInitializers = findMarkers(modules, DANGLING_INITIALIZER_MARKERS);
if (danglingInitializers.length > 0) {
  throw new Error(
    `Background module graph contains dangling initializers: ${danglingInitializers.join(', ')}`,
  );
}

const dynamicImports = findDynamicImports(modules);
if (dynamicImports.length > 0) {
  throw new Error(
    `Background module graph uses dynamic import(): ${dynamicImports.join(', ')}. ` +
      'Dynamic import() is disallowed on ServiceWorkerGlobalScope by the HTML specification, ' +
      "so Chrome rejects the import at runtime; Vite's __vitePreload wrapper then swallows that " +
      'rejection in its `vite:preloadError` reporter and the tool fails with the misleading ' +
      '`window is not defined` (or `document is not defined`). Hoist the import to a static ' +
      'top-level import in the module reached from the Service Worker.',
  );
}

console.log(
  `[bundle-contract] background graph ${modules.size} modules / ${size} bytes; ` +
    'PGlite runtime, dangling initializers and dynamic import() absent',
);

async function readModuleGraph(entryPath) {
  const modules = new Map();
  const pending = [entryPath];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (modules.has(modulePath)) continue;

    const source = await readFile(modulePath, 'utf8');
    modules.set(modulePath, source);

    for (const specifier of localModuleSpecifiers(source)) {
      const importedPath = path.resolve(path.dirname(modulePath), specifier);
      const relativePath = path.relative(outputDir, importedPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Background module import escapes output directory: ${specifier}`);
      }
      pending.push(importedPath);
    }
  }

  return modules;
}

/**
 * Every dynamic `import()` reachable from the Service Worker entry, as
 * `specifier (module)` strings. A Service Worker may only use static imports
 * (HTML spec forbids `import()` on `ServiceWorkerGlobalScope`), and the
 * failure surfaces only in the bundled artifact — source-level checks cannot
 * see which module WXT/Vite ends up placing in the Background graph.
 */
function findDynamicImports(modules) {
  const found = [];
  for (const [modulePath, source] of modules) {
    for (const match of source.matchAll(dynamicImportPattern())) {
      const specifier = match[1] ?? '<computed specifier>';
      found.push(`${specifier} (${path.relative(outputDir, modulePath)})`);
    }
  }
  return found;
}

function localModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g,
    dynamicImportPattern(),
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      // `match[1]` is undefined for a computed dynamic-import specifier: it is
      // unresolvable here, and `findDynamicImports` rejects it separately.
      if (match[1]?.startsWith('.')) specifiers.add(match[1]);
    }
  }

  return specifiers;
}

function findMarkers(modules, markers) {
  const found = [];
  for (const marker of markers) {
    for (const [modulePath, source] of modules) {
      if (source.includes(marker)) {
        found.push(`${marker} (${path.relative(outputDir, modulePath)})`);
      }
    }
  }
  return found;
}
