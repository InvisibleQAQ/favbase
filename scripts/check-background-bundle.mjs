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

console.log(
  `[bundle-contract] background graph ${modules.size} modules / ${size} bytes; ` +
    'PGlite runtime and dangling initializers absent',
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

function localModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s*(?:[^"'();]*?\bfrom\s*)?["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith('.')) specifiers.add(match[1]);
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
