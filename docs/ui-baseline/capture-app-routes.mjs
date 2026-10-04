// Captures app.html routes from a running browser over the Chrome DevTools
// Protocol. This is the script that produced public/assets/images/welcome/tour-*.webp
// (docs/35). It drives ONE tab that you opened for it and never another tab.
//
// Why CDP and not the BrowserOS MCP: the MCP opens a chrome-extension:// tab and
// then loses it ("Unknown page"), and its page list omits extension pages.
//
// Prerequisites: favbase loaded in a browser with a debugging port (BrowserOS:
// 9110, override with FAVBASE_CDP_PORT), a populated library, and a tab of your
// own on app.html:
//   curl -X PUT "http://127.0.0.1:9110/json/new?chrome-extension://<id>/app.html"
// The "id" in the reply is <targetId> below. Close it when done
// (/json/close/<targetId>): app.html has no cross-tab job lock, so a second tab
// runs the processing lanes a second time for as long as it stays open.
//
//   node capture-app-routes.mjs <targetId> state
//   node capture-app-routes.mjs <targetId> reload                 (reload + isolate)
//   node capture-app-routes.mjs <targetId> isolate
//   node capture-app-routes.mjs <targetId> theme <light|dark>     (tab-local, needs isolate)
//   node capture-app-routes.mjs <targetId> ui-locale <zh-CN|en>   (tab-local, needs isolate)
//   node capture-app-routes.mjs <targetId> shoot <outDir> <suffix> <name=path> [name=path ...]
//   node capture-app-routes.mjs <targetId> eval <file.js>
//
// "shoot" takes route paths WITHOUT the leading "#/" ("dashboard=" is the root,
// "github=collections/github"): Git Bash rewrites a literal "#/..." argument
// into a Windows path. Output is <outDir>/<name>-<suffix>.png at 1440x900 @2x.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [id, cmd, ...rest] = process.argv.slice(2);
const PORT = Number(process.env.FAVBASE_CDP_PORT ?? 9110);
const W = 1440;
const H = 900;
const DPR = 2;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.id === id);
if (!target) {
  console.error('no target', id);
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
let seq = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++seq;
    pending.set(i, (m) =>
      m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)
    );
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? 'eval error');
  }
  return r.result.value;
};

const STATE = `(async () => {
  const s = await chrome.storage.local.get(['locale']);
  return {
    href: location.href,
    scheme: document.documentElement.getAttribute('data-color-scheme'),
    storedMode: localStorage.getItem('favbase-color-mode'),
    storedLocale: s.locale ?? '(unset=auto)',
    isolated: window.__fbIsolated === true,
    entry: [...document.scripts].map((x) => x.src.split('/').pop()).filter((x) => x.startsWith('app-'))[0],
    w: innerWidth, h: innerHeight, dpr: devicePixelRatio,
  };
})()`;

// Settled = no route/loading spinner in <main>, no skeletons, every <img> decoded.
const SETTLED = `(() => {
  const main = document.querySelector('main');
  if (!main) return { ok: false, why: document.body.innerText.slice(0, 80) };
  // Every routed page owns an <h1>; the Suspense LoadingScreen has none. The
  // pipeline strip's own progress bars are content, not loading.
  const spin = main.querySelector('h1') ? 0 : 1;
  const skel = document.querySelectorAll('.MuiSkeleton-root').length;
  const imgs = [...document.images];
  const loading = imgs.filter((i) => !i.complete).length;
  const broken = imgs.filter((i) => i.complete && i.naturalWidth === 0).length;
  return { ok: spin === 0 && skel === 0 && loading === 0, spin, skel, loading, broken, imgs: imgs.length };
})()`;

// Keep mode / locale flips inside THIS tab: MUI persists the mode to
// localStorage (fires 'storage' in every other extension page) and i18n persists
// the locale to chrome.storage (watched by every context). Both apply in memory
// first, so swallowing the write isolates the flip. Dies with the page.
const ISOLATE = `(() => {
  if (window.__fbIsolated) return 'already';
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (k === 'favbase-color-mode') return undefined;
    return setItem.call(this, k, v);
  };
  const area = chrome.storage.local;
  const set = area.set.bind(area);
  area.set = (items, cb) => {
    const rest = { ...items };
    delete rest.locale;
    if (Object.keys(rest).length === 0) { if (cb) cb(); return Promise.resolve(); }
    return set(rest, cb);
  };
  window.__fbIsolated = true;
  return 'ok';
})()`;

async function settle(timeoutMs = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await evaluate(SETTLED);
    if (last.ok) break;
    await sleep(300);
  }
  await sleep(700); // transitions (Fade/Grow, tab indicator) finish
  return last;
}

const requireIsolated = async () => {
  if ((await evaluate('window.__fbIsolated === true')) !== true) throw new Error('not isolated');
};

if (cmd === 'state') {
  console.log(JSON.stringify(await evaluate(STATE)));
} else if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(readFileSync(rest[0], 'utf8')), null, 2));
} else if (cmd === 'reload') {
  await send('Page.bringToFront');
  await send('Page.reload', { ignoreCache: true });
  await sleep(2500);
  console.log('settled', JSON.stringify(await settle()));
  console.log('isolate', await evaluate(ISOLATE));
  console.log(JSON.stringify(await evaluate(STATE)));
} else if (cmd === 'isolate') {
  console.log('isolate', await evaluate(ISOLATE));
} else if (cmd === 'ui-locale') {
  await requireIsolated();
  const index = rest[0] === 'zh-CN' ? 0 : 1;
  await send('Page.bringToFront');
  const opened = await evaluate(`(() => {
    const btn = [...document.querySelectorAll('header button')].find((b) =>
      /language|语言/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!opened) throw new Error('language button not found');
  await sleep(600);
  const picked = await evaluate(`(() => {
    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const it = items[${index}];
    if (!it) return 'no-item:' + items.length;
    it.click();
    return it.textContent;
  })()`);
  await sleep(900);
  console.log('picked', picked, JSON.stringify(await evaluate(STATE)));
} else if (cmd === 'theme') {
  await requireIsolated();
  const want = rest[0];
  await send('Page.bringToFront');
  const before = await evaluate(`document.documentElement.getAttribute('data-color-scheme')`);
  if (before !== want) {
    // The header ThemeModeButton is the product's own switch; its aria-label is
    // localized, so match either language.
    const clicked = await evaluate(`(() => {
      const btn = [...document.querySelectorAll('header button')].find((b) =>
        /dark mode|light mode|深色|浅色|暗色|亮色/i.test(b.getAttribute('aria-label') || ''));
      if (!btn) return false;
      btn.click();
      return btn.getAttribute('aria-label');
    })()`);
    if (!clicked) throw new Error('theme button not found');
    await sleep(1500); // view-transition reveal
  }
  console.log(JSON.stringify(await evaluate(STATE)));
} else if (cmd === 'shoot') {
  const [outDir, suffix, ...routes] = rest;
  mkdirSync(outDir, { recursive: true });
  await send('Page.bringToFront');
  await send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: DPR,
    mobile: false,
  });
  await sleep(500);
  for (const spec of routes) {
    const [name, path = ''] = spec.split('=');
    // Built here: Git Bash rewrites a literal '#/...' argv into a Windows path.
    const hash = '#/' + path;
    await evaluate(`(location.hash = ${JSON.stringify(hash)}, window.scrollTo(0, 0), 1)`);
    await sleep(400);
    const s = await settle();
    await evaluate(
      `(window.scrollTo(0, 0), document.activeElement && document.activeElement.blur && document.activeElement.blur(), 1)`
    );
    await sleep(200);
    const { data } = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    const file = join(outDir, `${name}-${suffix}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(name, hash, JSON.stringify(s));
  }
  await send('Emulation.clearDeviceMetricsOverride');
} else {
  console.error('unknown cmd', cmd);
}
ws.close();
process.exit(0);
