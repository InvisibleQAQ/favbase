// Phase 2 shell runtime check: launches an isolated Chrome, installs the built
// extension via CDP Extensions.loadUnpacked (Chrome 137+ dropped
// --load-extension), measures shell geometry at 1440/1024/390 and saves
// screenshots. Zero deps: CDP over --remote-debugging-pipe (fd 3/4).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const EXT = resolve('C:/tmp/favbase-minimal-v7-phase2/.output/chrome-mv3');
const OUT = process.argv[2] ?? 'C:/tmp/favbase-phase2-shots';
const PROFILE = 'C:/tmp/favbase-phase2-profile';

rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    `--user-data-dir=${PROFILE}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=1500,1000',
    '--lang=zh-CN',
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
);

process.on('exit', () => chrome.kill());
process.on('uncaughtException', (e) => { console.error(e); chrome.kill(); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); chrome.kill(); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(writer, reader) {
    this.writer = writer;
    this.id = 0;
    this.pending = new Map();
    let buffer = '';
    reader.setEncoding('utf8');
    reader.on('data', (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\0')) >= 0) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        const msg = JSON.parse(raw);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          msg.error ? reject(new Error(`${msg.error.message} (${msg.error.data ?? ''})`)) : resolve(msg.result);
        }
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.writer.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
}

const cdp = new CDP(chrome.stdio[3], chrome.stdio[4]);
await cdp.send('Target.getTargets'); // handshake
const { id: extId } = await cdp.send('Extensions.loadUnpacked', { path: EXT });
console.log('extension id', extId);
await sleep(1500); // let onInstalled open welcome.html; we use our own tab

const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => cdp.send(method, params, sessionId);
await page('Page.enable');
await page('Runtime.enable');

async function evaluate(expression) {
  const { result, exceptionDetails } = await page('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails, null, 1));
  return result.value;
}

async function goto(hash) {
  await page('Page.navigate', { url: `chrome-extension://${extId}/app.html#${hash}` });
  for (let i = 0; i < 80; i++) {
    const ready = await evaluate(
      `!!document.querySelector('nav') && !!document.querySelector('header') && document.fonts.status === 'loaded'`,
    );
    if (ready) return sleep(600);
    await sleep(250);
  }
  const dump = await evaluate(
    `JSON.stringify({ url: location.href, title: document.title, body: document.body.innerHTML.slice(0, 1500) })`,
  );
  throw new Error(`page did not become ready: ${dump}`);
}

async function viewport(width, height, mobile) {
  await page('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await sleep(500);
}

async function shot(name) {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log('saved', name);
}

const MEASURE = `(() => {
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; };
  const doc = document.documentElement;
  const nav = document.querySelector('nav');
  const navRoot = nav?.closest('.MuiDrawer-paper') ?? nav?.parentElement;
  const header = document.querySelector('header');
  const controls = [...header.querySelectorAll('button, a, [role="button"]')].map((el) => ({ label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20), ...rect(el) }));
  let overlap = null;
  for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
    const a = controls[i], b = controls[j];
    if (a.w && b.w && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlap = [a.label, b.label];
  }
  const rows = [...(nav?.querySelectorAll('li > a, li > div > a') ?? [])].map((a) => ({ href: a.getAttribute('href'), h: +a.getBoundingClientRect().height.toFixed(1), w: +a.getBoundingClientRect().width.toFixed(1), text: a.textContent.trim() }));
  const titles = [...(nav?.querySelectorAll('a span:not(.favbase-nav-icon)') ?? [])].filter((s) => s.textContent.trim()).map((s) => ({ text: s.textContent.trim(), clipped: s.scrollWidth > s.clientWidth + 1 }));
  const h1 = document.querySelector('h1');
  const main = document.querySelector('main');
  const content = main?.querySelector('.MuiContainer-root');
  const cs = getComputedStyle(doc);
  return {
    viewport: [innerWidth, innerHeight],
    horizontalScroll: doc.scrollWidth > doc.clientWidth,
    navVar: cs.getPropertyValue('--layout-nav-vertical-width').trim(),
    scrollPaddingTop: cs.scrollPaddingTop,
    navRect: navRoot ? rect(navRoot) : null,
    headerRect: rect(header),
    headerPaddingLeft: getComputedStyle(header.querySelector('.MuiContainer-root')).paddingLeft,
    contentPaddingLeft: content ? getComputedStyle(content).paddingLeft : null,
    contentRect: content ? rect(content) : null,
    h1Rect: h1 ? rect(h1) : null,
    controls,
    overlap,
    rows,
    clippedTitles: titles.filter((t) => t.clipped),
    activeElement: document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName,
  };
})()`;

const results = {};
async function measure(name) {
  results[name] = await evaluate(MEASURE);
  console.log(name, JSON.stringify(results[name]));
}

// --- desktop 1440, pinned (default), zh ---
await viewport(1440, 900, false);
await goto('/collections/bilibili');
await measure('1440-pinned-zh');
await shot('1440-pinned-zh-light');

// switch to en for label width check
await evaluate(`chrome.storage.local.set({ locale: 'en' })`);
await sleep(800);
await measure('1440-pinned-en');
await shot('1440-pinned-en-light');

// compact
await evaluate(`document.querySelector('header button[aria-expanded]').click()`);
await sleep(600);
await measure('1440-compact-en');
await shot('1440-compact-en-light');

// dark, compact
await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await sleep(600);
await shot('1440-compact-en-dark');
// back to pinned, dark
await evaluate(`document.querySelector('header button[aria-expanded]').click()`);
await sleep(600);
await shot('1440-pinned-en-dark');
await page('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

// --- 1024 ---
await viewport(1024, 768, false);
await sleep(600);
await measure('1024-pinned-en');
await shot('1024-pinned-en-light');

// --- 390 mobile ---
await viewport(390, 844, true);
await sleep(600);
await measure('390-en');
await shot('390-en-light');
// open drawer
await evaluate(`(() => { const b = document.querySelector('header button[aria-label]'); b.focus(); b.click(); })()`);
await sleep(700);
await measure('390-drawer-open');
await shot('390-drawer-open-light');
// navigate from the drawer, then check focus restoration
await evaluate(`document.querySelector('.MuiDrawer-paper a[href$="/settings"]').click()`);
await sleep(1200);
await measure('390-after-drawer-nav');
await shot('390-after-nav-light');
// zh at 390: longest zh label in the drawer
await evaluate(`chrome.storage.local.set({ locale: 'zh-CN' })`);
await sleep(800);
await evaluate(`(() => { const b = document.querySelector('header button[aria-label]'); b.click(); })()`);
await sleep(700);
await measure('390-drawer-zh');
await shot('390-drawer-zh-light');

writeFileSync(join(OUT, 'measurements.json'), JSON.stringify(results, null, 2));
chrome.kill();
process.exit(0);
