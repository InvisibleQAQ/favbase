import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BACKGROUND_BYTES = 2 * 1024 * 1024;
const PGLITE_MARKERS = [
  'idb://favbase',
  'pglite.wasm',
  'Postgres tried to execute',
  'PGlite.create',
  'DatabaseRpcHandler',
];

const root = fileURLToPath(new URL('../', import.meta.url));
const outputDir = path.join(root, '.output', 'chrome-mv3');
const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
const serviceWorker = manifest.background?.service_worker;

if (typeof serviceWorker !== 'string' || serviceWorker.length === 0) {
  throw new Error('Chrome MV3 manifest has no background service worker');
}

const backgroundPath = path.join(outputDir, serviceWorker);
const [{ size }, background] = await Promise.all([
  stat(backgroundPath),
  readFile(backgroundPath, 'utf8'),
]);

if (size > MAX_BACKGROUND_BYTES) {
  throw new Error(
    `Background bundle is ${size} bytes; limit is ${MAX_BACKGROUND_BYTES}. ` +
      'Check for a heavy transitive dependency.',
  );
}

const foundMarkers = PGLITE_MARKERS.filter((marker) => background.includes(marker));
if (foundMarkers.length > 0) {
  throw new Error(`Background bundle contains PGlite markers: ${foundMarkers.join(', ')}`);
}

console.log(`[bundle-contract] background ${size} bytes; PGlite runtime absent`);
