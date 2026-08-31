// Zero-dependency Chrome/CDP runtime validation for the built app.html.
// Attaches to the user's existing Chrome page so extension cookies and PGlite
// data remain available, then restores the page state after the matrix run.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const EXTENSION = resolve('.output/chrome-mv3');
const OUTPUT = resolve(process.argv[2] ?? 'docs/ui-baseline/2026-08-31/phase7-validation');
const DEVTOOLS_ACTIVE_PORT = process.env.FAVBASE_PHASE7_DEVTOOLS_ACTIVE_PORT ?? join(
  process.env.LOCALAPPDATA ?? '',
  'Google',
  'Chrome',
  'User Data',
  'DevToolsActivePort',
);

const ROUTES = [
  ['dashboard', '/'],
  ['collections', '/collections'],
  ['collections-tag', '/collections?tag=00000000-0000-0000-0000-000000000000'],
  ['bilibili', '/collections/bilibili'],
  ['bilibili-deep-link', '/collections/bilibili/phase7-missing'],
  ['github', '/collections/github'],
  ['bookmarks', '/collections/bookmarks'],
  ['bookmarks-deep-link', '/collections/bookmarks/phase7-missing'],
  ['x', '/collections/x'],
  ['zhihu', '/collections/zhihu'],
  ['youtube', '/collections/youtube'],
  ['chat', '/chat'],
  ['settings', '/settings'],
  ['settings-deep-link', '/settings?section=embedding&resume=github'],
];

const REPRESENTATIVE_ROUTES = ROUTES.filter(([name]) =>
  ['dashboard', 'collections', 'bilibili', 'chat', 'settings'].includes(name),
);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function readBrowserWebSocketUrl() {
  if (process.env.FAVBASE_PHASE7_CDP_URL) return process.env.FAVBASE_PHASE7_CDP_URL;

  const [port, browserPath] = readFileSync(DEVTOOLS_ACTIVE_PORT, 'utf8').trim().split(/\r?\n/);
  if (!/^\d+$/.test(port) || !browserPath?.startsWith('/devtools/browser/')) {
    throw new Error(`Invalid DevToolsActivePort content: ${DEVTOOLS_ACTIVE_PORT}`);
  }
  return `ws://127.0.0.1:${port}${browserPath}`;
}

mkdirSync(OUTPUT, { recursive: true });

class CDP {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.socket.addEventListener('open', resolveReady, { once: true });
      this.socket.addEventListener('error', () => rejectReady(new Error(`Cannot connect to ${url}`)), { once: true });
    });
    this.socket.addEventListener('message', ({ data }) => this.handle(JSON.parse(data)));
    this.socket.addEventListener('close', () => {
      for (const { reject } of this.pending.values()) reject(new Error('Chrome DevTools connection closed'));
      this.pending.clear();
    });
  }

  handle(message) {
    if (message.id && this.pending.has(message.id)) {
      const { resolve: resolveRequest, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        reject(new Error(`${message.error.message} (${message.error.data ?? ''})`));
      } else {
        resolveRequest(message.result);
      }
      return;
    }

    if (message.method) {
      for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
    }
  }

  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolveRequest, reject) => {
      this.pending.set(id, { resolve: resolveRequest, reject });
      this.socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }
}

const cdp = new CDP(readBrowserWebSocketUrl());
const { targetInfos } = await cdp.send('Target.getTargets');
const requestedTargetId = process.env.FAVBASE_PHASE7_TARGET_ID;
const appTargets = targetInfos.filter((target) =>
  target.type === 'page' && /^chrome-extension:\/\/[a-p]{32}\/app\.html(?:[?#]|$)/.test(target.url),
);
const target = requestedTargetId
  ? appTargets.find(({ targetId }) => targetId === requestedTargetId)
  : appTargets.find(({ url }) => !url.includes('#')) ?? appTargets[0];
if (!target) {
  throw new Error(`Existing Favbase app page not found${requestedTargetId ? `: ${requestedTargetId}` : ''}`);
}

const { targetId } = target;
const extensionId = new URL(target.url).hostname;
await cdp.send('Target.activateTarget', { targetId });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
const page = (method, params) => cdp.send(method, params, sessionId);

await page('Page.enable');
await page('Runtime.enable');
await page('Log.enable');

const runtimeEvents = [];
cdp.on('Runtime.consoleAPICalled', (event) => {
  runtimeEvents.push({
    kind: 'console',
    level: event.type,
    text: event.args.map((arg) => arg.value ?? arg.description ?? '').join(' '),
    timestamp: event.timestamp,
  });
});
cdp.on('Runtime.exceptionThrown', (event) => {
  runtimeEvents.push({
    kind: 'exception',
    level: 'error',
    text: event.exceptionDetails?.exception?.description ?? event.exceptionDetails?.text ?? 'Unknown exception',
    timestamp: event.timestamp,
  });
});
cdp.on('Log.entryAdded', ({ entry }) => {
  runtimeEvents.push({
    kind: 'log',
    level: entry.level,
    text: entry.text,
    source: entry.source,
    url: entry.url,
    timestamp: entry.timestamp,
  });
});

await page('Page.addScriptToEvaluateOnNewDocument', {
  source: `
    window.__favbasePhase7 = { layoutShifts: [] };
    const plainRect = (rect) => ({
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) {
            window.__favbasePhase7.layoutShifts.push({
              value: entry.value,
              startTime: entry.startTime,
              sources: (entry.sources ?? []).map((source) => ({
                node: source.node ? [
                  source.node.tagName,
                  source.node.id ? '#' + source.node.id : '',
                  source.node.classList?.length ? '.' + [...source.node.classList].slice(0, 3).join('.') : '',
                ].join('') : null,
                previousRect: plainRect(source.previousRect),
                currentRect: plainRect(source.currentRect),
              })),
            });
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
  `,
});

async function evaluate(expression) {
  const { result, exceptionDetails } = await page('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails, null, 2));
  return result.value;
}

const originalPageState = await evaluate(`(async () => {
  const storage = await chrome.storage.local.get(['locale', 'sidebarPinned']);
  return {
    url: location.href,
    colorModePresent: localStorage.getItem('favbase-color-mode') !== null,
    colorMode: localStorage.getItem('favbase-color-mode'),
    storage,
    storageKeys: {
      locale: Object.prototype.hasOwnProperty.call(storage, 'locale'),
      sidebarPinned: Object.prototype.hasOwnProperty.call(storage, 'sidebarPinned'),
    },
  };
})()`);

const runtimeResources = await evaluate(`(async () => {
  const urls = [...new Set([
    new URL('/app.html', location.href).href,
    ...[...document.querySelectorAll('script[src], link[href]')].map((element) => element.src || element.href),
  ])];
  const toHex = (buffer) => [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const resources = [];
  for (const url of urls) {
    const response = await fetch(url);
    const bytes = await response.arrayBuffer();
    resources.push({
      pathname: new URL(url).pathname,
      ok: response.ok,
      size: bytes.byteLength,
      sha256: toHex(await crypto.subtle.digest('SHA-256', bytes)),
    });
  }
  return resources;
})()`);

const sourceVerification = runtimeResources.map((resource) => {
  const relativePath = decodeURIComponent(resource.pathname).replace(/^\/+/, '');
  const localPath = resolve(EXTENSION, relativePath);
  if (localPath !== EXTENSION && !localPath.startsWith(`${EXTENSION}${sep}`)) {
    throw new Error(`Runtime resource escaped extension root: ${resource.pathname}`);
  }

  try {
    const bytes = readFileSync(localPath);
    const localSha256 = createHash('sha256').update(bytes).digest('hex');
    return {
      ...resource,
      localPath,
      localSize: bytes.byteLength,
      localSha256,
      matches: resource.ok && resource.size === bytes.byteLength && resource.sha256 === localSha256,
    };
  } catch (error) {
    return { ...resource, localPath, matches: false, error: error.message };
  }
});

async function restoreOriginalState() {
  await cdp.send('Target.activateTarget', { targetId });
  await page('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page('Emulation.clearDeviceMetricsOverride');
  await page('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(`(async () => {
    const state = ${JSON.stringify(originalPageState)};
    if (state.colorModePresent) localStorage.setItem('favbase-color-mode', state.colorMode);
    else localStorage.removeItem('favbase-color-mode');

    const updates = {};
    const removals = [];
    for (const key of ['locale', 'sidebarPinned']) {
      if (state.storageKeys[key]) updates[key] = state.storage[key];
      else removals.push(key);
    }
    if (Object.keys(updates).length) await chrome.storage.local.set(updates);
    if (removals.length) await chrome.storage.local.remove(removals);
  })()`);
  await page('Page.navigate', { url: originalPageState.url });
  await sleep(1000);
  await cdp.send('Target.activateTarget', { targetId });
}

let navigationNonce = 0;
async function goto(route, { reload = false } = {}) {
  if (reload) {
    navigationNonce += 1;
    await page('Page.navigate', {
      url: `chrome-extension://${extensionId}/app.html?phase7=${navigationNonce}#${route}`,
    });
  } else {
    await evaluate(`location.hash = ${JSON.stringify(route)}`);
  }

  const readyHashes = route.startsWith('/collections?tag=')
    ? [`#${route}`, '#/collections']
    : [`#${route}`];
  let stableSamples = 0;
  for (let attempt = 0; attempt < 900; attempt += 1) {
    const ready = await evaluate(`(() => ({
      hash: location.hash,
      root: !!document.querySelector('#root'),
      header: !!document.querySelector('header'),
      main: !!document.querySelector('main'),
      h1: !!document.querySelector('h1'),
      fonts: document.fonts.status,
      skeletons: document.querySelectorAll('.MuiSkeleton-root').length,
      busy: document.querySelectorAll('[aria-busy="true"]').length,
    }))()`);
    if (
      readyHashes.includes(ready.hash) &&
      ready.root &&
      ready.header &&
      ready.main &&
      ready.h1 &&
      ready.fonts === 'loaded' &&
      ready.skeletons === 0 &&
      ready.busy === 0
    ) {
      stableSamples += 1;
      if (stableSamples >= 3) return;
    } else {
      stableSamples = 0;
    }
    await sleep(100);
  }

  const dump = await evaluate(`JSON.stringify({
    url: location.href,
    hash: location.hash,
    title: document.title,
    body: document.body.innerHTML.slice(0, 2000),
  })`);
  throw new Error(`Page did not become ready for ${route}: ${dump}`);
}

async function viewport(width, height, mobile = false) {
  await page('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
  await page('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
  await sleep(300);
}

async function configure({ theme, locale, pinned = true, reducedMotion = false }) {
  await page('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-color-scheme', value: theme },
      { name: 'prefers-reduced-motion', value: reducedMotion ? 'reduce' : 'no-preference' },
    ],
  });
  await evaluate(`(async () => {
    localStorage.setItem('favbase-color-mode', ${JSON.stringify(theme)});
    await chrome.storage.local.set({
      locale: ${JSON.stringify(locale)},
      sidebarPinned: ${pinned},
    });
  })()`);
}

async function screenshot(name) {
  const { data } = await page('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(OUTPUT, `${name}.png`), Buffer.from(data, 'base64'));
}

const auditExpression = `(() => {
  const doc = document.documentElement;
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
  };
  const label = (element) =>
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 80) ||
    element.tagName;
  const parseColor = (value) => {
    const match = value.match(/rgba?\\(([^)]+)\\)/);
    if (!match) return null;
    const parts = match[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
  };
  const blend = (front, back) => {
    const alpha = front.a + back.a * (1 - front.a);
    if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
    return {
      r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
      g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
      b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
      a: alpha,
    };
  };
  const backgroundFor = (element) => {
    const chain = [];
    for (let current = element; current instanceof Element; current = current.parentElement) chain.push(current);
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const current of chain.reverse()) {
      const color = parseColor(getComputedStyle(current).backgroundColor);
      if (color && color.a > 0) result = blend(color, result);
    }
    return result;
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => {
      const normalized = value / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const contrast = (a, b) => {
    const first = luminance(a);
    const second = luminance(b);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  };

  const interactive = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="tab"]')]
    .filter((element) => visible(element) && !element.matches(':disabled') && element.getAttribute('aria-disabled') !== 'true');
  const targetIssues = interactive.flatMap((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (element.tagName === 'A' && style.display === 'inline') return [];
    if (rect.width >= 24 && rect.height >= 24) return [];
    return [{ label: label(element), tag: element.tagName, width: +rect.width.toFixed(1), height: +rect.height.toFixed(1) }];
  });

  const contrastIssues = [];
  const seenText = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent?.trim();
    const element = walker.currentNode.parentElement;
    if (!text || !element || !visible(element) || element.closest('[aria-hidden="true"], [disabled], [aria-disabled="true"]')) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || Number(style.opacity) < 0.5) continue;
    const foreground = parseColor(style.color);
    const background = backgroundFor(element);
    if (!foreground || foreground.a === 0) continue;
    const effectiveForeground = blend(foreground, background);
    const fontSize = Number.parseFloat(style.fontSize);
    const fontWeight = Number.parseInt(style.fontWeight, 10) || 400;
    const threshold = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
    const ratio = contrast(effectiveForeground, background);
    const key = [
      text.slice(0, 80),
      [foreground.r, foreground.g, foreground.b].join(','),
      [background.r.toFixed(0), background.g.toFixed(0), background.b.toFixed(0)].join(','),
    ].join('|');
    if (ratio + 0.01 < threshold && !seenText.has(key)) {
      seenText.add(key);
      contrastIssues.push({ text: text.slice(0, 80), ratio: +ratio.toFixed(2), threshold, fontSize, fontWeight });
    }
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    .filter(visible)
    .map((element) => ({ level: Number(element.tagName.slice(1)), text: label(element) }));
  const headingSkips = headings.flatMap((heading, index) => {
    if (index === 0 || heading.level <= headings[index - 1].level + 1) return [];
    return [{ from: headings[index - 1], to: heading }];
  });
  const brokenImages = [...document.images]
    .filter(visible)
    .filter((image) => !image.complete || image.naturalWidth === 0)
    .map((image) => image.currentSrc || image.src);
  const clippedText = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,label,button,a,.MuiChip-label,.MuiTab-root')]
    .filter(visible)
    .flatMap((element) => {
      const style = getComputedStyle(element);
      const intentionallyScrollable = ['auto', 'scroll'].includes(style.overflowX);
      const ellipsis = style.textOverflow === 'ellipsis';
      if (element.scrollWidth <= element.clientWidth + 1 || intentionallyScrollable || ellipsis) return [];
      return [{ label: label(element), tag: element.tagName, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }];
    });
  const active = document.activeElement;
  const activeRect = active instanceof Element ? active.getBoundingClientRect() : null;
  const headerRect = document.querySelector('header')?.getBoundingClientRect();

  return {
    route: location.hash,
    theme: doc.getAttribute('data-color-scheme'),
    viewport: [innerWidth, innerHeight],
    visualViewport: window.visualViewport ? {
      width: +window.visualViewport.width.toFixed(1),
      height: +window.visualViewport.height.toFixed(1),
      scale: +window.visualViewport.scale.toFixed(2),
    } : null,
    horizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
    documentWidth: [doc.clientWidth, doc.scrollWidth],
    h1Count: headings.filter((heading) => heading.level === 1).length,
    headings,
    headingSkips,
    targetIssues,
    contrastIssues,
    brokenImages,
    clippedText,
    fonts: {
      status: document.fonts.status,
      dmSans: document.fonts.check('16px "DM Sans Variable"'),
      barlow: document.fonts.check('700 28px "Barlow"'),
    },
    layoutShifts: window.__favbasePhase7?.layoutShifts ?? [],
    cumulativeLayoutShift: +(window.__favbasePhase7?.layoutShifts ?? [])
      .reduce((sum, entry) => sum + (typeof entry === 'number' ? entry : entry.value), 0)
      .toFixed(4),
    activeElement: active instanceof Element ? label(active) : null,
    activeFullyVisible: !activeRect || (
      activeRect.left >= 0 && activeRect.right <= innerWidth && activeRect.top >= 0 && activeRect.bottom <= innerHeight
    ),
    activeObscuredByHeader: !!activeRect && !!headerRect && activeRect.top < headerRect.bottom && activeRect.bottom > headerRect.top,
  };
})()`;

const report = {
  generatedAt: new Date().toISOString(),
  branch: 'feat/minimal-v7-phase2-shell',
  browserMode: 'existing-user-profile',
  targetId,
  extensionId,
  extensionPath: EXTENSION,
  originalPageState,
  sourceVerification,
  matrix: {},
  interactions: {},
  runtimeEvents,
  expectedRuntimeEvents: [],
  failures: [],
  notes: [
    'Screenshots are compared by product structure and behavior, not as pixel goldens.',
    'The matrix runs against the user\'s existing Chrome page, cookies, extension storage, and live PGlite collection data.',
    'The script restores the original URL, theme, locale, sidebar preference, and emulation overrides before detaching.',
  ],
};

function isExpectedHandledEvent(event) {
  return (
    event.kind === 'log' &&
    event.source === 'network' &&
    event.level === 'error' &&
    event.url === 'https://www.zhihu.com/api/v4/me' &&
    event.text.includes('status of 401')
  );
}

function check(condition, message, details) {
  if (!condition) report.failures.push({ message, details });
}

async function audit(name, route, { capture = false } = {}) {
  const eventStart = runtimeEvents.length;
  await evaluate(`{ if (window.__favbasePhase7) window.__favbasePhase7.layoutShifts = []; }`);
  await goto(route);
  await evaluate('document.fonts.ready');
  const result = await evaluate(auditExpression);
  const routeEvents = runtimeEvents.slice(eventStart);
  result.expectedRuntimeEvents = routeEvents.filter(isExpectedHandledEvent);
  result.runtimeEvents = routeEvents.filter((event) =>
    (event.level === 'error' || event.kind === 'exception') && !isExpectedHandledEvent(event),
  );
  report.matrix[name] = result;

  const expectedRoute = route.startsWith('/collections?tag=') ? '#/collections' : `#${route}`;
  check(result.route === expectedRoute, `${name}: route drift`, { expectedRoute, actual: result.route });
  check(result.h1Count === 1, `${name}: expected exactly one h1`, result.headings);
  check(result.headingSkips.length === 0, `${name}: heading level skip`, result.headingSkips);
  check(!result.horizontalScroll, `${name}: document has horizontal scroll`, result.documentWidth);
  check(result.brokenImages.length === 0, `${name}: broken image`, result.brokenImages);
  check(result.fonts.status === 'loaded' && result.fonts.dmSans && result.fonts.barlow, `${name}: fonts not loaded`, result.fonts);
  check(result.cumulativeLayoutShift < 0.1, `${name}: CLS exceeds 0.1`, result.cumulativeLayoutShift);
  check(result.contrastIssues.length === 0, `${name}: text contrast failure`, result.contrastIssues);
  check(result.runtimeEvents.length === 0, `${name}: console error or exception`, result.runtimeEvents);

  if (capture) await screenshot(name);
  console.log(name, JSON.stringify({
    route: result.route,
    theme: result.theme,
    viewport: result.viewport,
    h1Count: result.h1Count,
    horizontalScroll: result.horizontalScroll,
    targets: result.targetIssues.length,
    contrast: result.contrastIssues.length,
    cls: result.cumulativeLayoutShift,
    errors: result.runtimeEvents.length,
  }));
}

async function runGroup({ name, width, height, mobile, theme, locale, routes, screenshots }) {
  await cdp.send('Target.activateTarget', { targetId });
  await viewport(width, height, mobile);
  await configure({ theme, locale });
  await goto('/', { reload: true });
  for (const [routeName, route] of routes) {
    await audit(`${name}-${routeName}`, route, { capture: screenshots.includes(routeName) });
    if (routeName === 'dashboard' && !report.liveDataSummary) {
      report.liveDataSummary = await evaluate(`(() => ({
        summary: document.querySelector('[data-section="summary"]')?.textContent?.trim().replace(/\\s+/g, ' '),
        platformTabs: [...document.querySelectorAll('[role="tab"]')]
          .map((tab) => tab.textContent?.trim().replace(/\\s+/g, ' ')),
      }))()`);
    }
    check(report.matrix[`${name}-${routeName}`].theme === theme, `${name}-${routeName}: theme mismatch`, {
      expected: theme,
      actual: report.matrix[`${name}-${routeName}`].theme,
    });
  }
}

check(sourceVerification.length >= 3, 'Runtime source verification did not cover app assets', sourceVerification);
check(
  sourceVerification.every((resource) => resource.matches),
  'Existing Favbase page is not running the target worktree build',
  sourceVerification.filter((resource) => !resource.matches),
);

let runError;
try {
  await runGroup({
  name: '1440-light-en',
  width: 1440,
  height: 900,
  mobile: false,
  theme: 'light',
  locale: 'en',
  routes: ROUTES,
  screenshots: ['dashboard', 'collections', 'chat', 'settings'],
  });

await goto('/');
await goto('/collections');
await evaluate('history.back()');
for (let attempt = 0; attempt < 30; attempt += 1) {
  if (await evaluate("location.hash === '#/'")) break;
  await sleep(100);
}
report.interactions.history = await evaluate(`({ hash: location.hash, h1: document.querySelector('h1')?.textContent?.trim() })`);
check(report.interactions.history.hash === '#/', 'Hash-router history did not return to dashboard', report.interactions.history);

const sidebarBefore = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--layout-nav-vertical-width').trim()`);
await evaluate(`document.querySelector('header button[aria-expanded]')?.click()`);
await sleep(500);
const sidebarCompact = await evaluate(`(async () => ({
  width: getComputedStyle(document.documentElement).getPropertyValue('--layout-nav-vertical-width').trim(),
  stored: (await chrome.storage.local.get('sidebarPinned')).sidebarPinned,
}))()`);
await evaluate(`document.querySelector('header button[aria-expanded]')?.click()`);
await sleep(500);
const sidebarRestored = await evaluate(`(async () => ({
  width: getComputedStyle(document.documentElement).getPropertyValue('--layout-nav-vertical-width').trim(),
  stored: (await chrome.storage.local.get('sidebarPinned')).sidebarPinned,
}))()`);
report.interactions.sidebar = { before: sidebarBefore, compact: sidebarCompact, restored: sidebarRestored };
check(sidebarBefore === '300px' && sidebarCompact.width === '88px' && sidebarCompact.stored === false, 'Sidebar compact persistence failed', report.interactions.sidebar);
check(sidebarRestored.width === '300px' && sidebarRestored.stored === true, 'Sidebar restore persistence failed', report.interactions.sidebar);

await goto('/settings');
await cdp.send('Target.activateTarget', { targetId });
const languageButtonLabel = await evaluate(`(() => {
  const buttons = [...document.querySelectorAll('header button')];
  return buttons.map((button) => button.getAttribute('aria-label')).find((label) => label?.toLowerCase().includes('language'));
})()`);
await evaluate(`(() => {
  const button = document.querySelector(${JSON.stringify(`header button[aria-label="${languageButtonLabel}"]`)});
  button?.focus();
  button?.click();
})()`);
await sleep(400);
report.interactions.languageMenuOpen = await evaluate(`(() => {
  const menu = document.querySelector('[role="menu"]');
  const rect = menu?.getBoundingClientRect();
  return { open: !!menu, rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null };
})()`);
await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(400);
report.interactions.languageMenuClosed = await evaluate(`({
  open: !!document.querySelector('[role="menu"]'),
  active: document.activeElement?.getAttribute('aria-label'),
  activeTag: document.activeElement?.tagName,
  activeText: document.activeElement?.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 80),
  restored: document.activeElement === document.querySelector(${JSON.stringify(`header button[aria-label="${languageButtonLabel}"]`)}),
})`);
check(report.interactions.languageMenuOpen.open, 'Language Menu did not open', report.interactions.languageMenuOpen);
check(
  report.interactions.languageMenuOpen.rect?.left >= 0 &&
  report.interactions.languageMenuOpen.rect?.right <= 1440 &&
  report.interactions.languageMenuOpen.rect?.bottom <= 900,
  'Language Menu exceeded viewport bounds',
  report.interactions.languageMenuOpen,
);
check(!report.interactions.languageMenuClosed.open && report.interactions.languageMenuClosed.restored, 'Language Menu did not close and restore focus', report.interactions.languageMenuClosed);

await runGroup({
  name: '1024-dark-zh',
  width: 1024,
  height: 768,
  mobile: false,
  theme: 'dark',
  locale: 'zh-CN',
  routes: REPRESENTATIVE_ROUTES,
  screenshots: ['dashboard', 'collections', 'settings'],
});

await runGroup({
  name: '390-light-zh',
  width: 390,
  height: 844,
  mobile: true,
  theme: 'light',
  locale: 'zh-CN',
  routes: ROUTES,
  screenshots: ['dashboard', 'collections', 'chat', 'settings'],
});

await goto('/settings');
await cdp.send('Target.activateTarget', { targetId });
const mobileMenuLabel = await evaluate(`document.querySelector('header button')?.getAttribute('aria-label')`);
await evaluate(`document.querySelector('header button')?.click()`);
await sleep(400);
report.interactions.appDrawerOpen = await evaluate(`(() => {
  const papers = [...document.querySelectorAll('.MuiDrawer-paper')].filter((paper) => {
    const rect = paper.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  });
  const rect = papers[0]?.getBoundingClientRect();
  return { count: papers.length, width: rect?.width, right: rect?.right, active: document.activeElement?.tagName };
})()`);
await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(700);
report.interactions.appDrawerClosed = await evaluate(`({
  visiblePapers: [...document.querySelectorAll('.MuiDrawer-paper')].filter((paper) => {
    const rect = paper.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  }).length,
  rootHidden: document.querySelector('#root')?.getAttribute('aria-hidden'),
  active: document.activeElement?.getAttribute('aria-label'),
})`);
check(report.interactions.appDrawerOpen.count === 1 && report.interactions.appDrawerOpen.width <= 358, 'App Drawer width/open state failed', report.interactions.appDrawerOpen);
check(
  report.interactions.appDrawerClosed.visiblePapers === 0 &&
  report.interactions.appDrawerClosed.rootHidden === null &&
  report.interactions.appDrawerClosed.active === mobileMenuLabel,
  'App Drawer did not close cleanly and restore focus',
  report.interactions.appDrawerClosed,
);

await goto('/chat');
await cdp.send('Target.activateTarget', { targetId });
const chatHistoryLabel = await evaluate(`document.querySelector('main h1')?.parentElement?.querySelector('button')?.getAttribute('aria-label')`);
await evaluate(`document.querySelector('main h1')?.parentElement?.querySelector('button')?.click()`);
await sleep(400);
report.interactions.chatDrawerOpen = await evaluate(`(() => {
  const papers = [...document.querySelectorAll('.MuiDrawer-paper')].filter((paper) => {
    const rect = paper.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  });
  return { count: papers.length, widths: papers.map((paper) => paper.getBoundingClientRect().width) };
})()`);
await page('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await page('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await sleep(700);
report.interactions.chatDrawerClosed = await evaluate(`({
  visiblePapers: [...document.querySelectorAll('.MuiDrawer-paper')].filter((paper) => {
    const rect = paper.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
  }).length,
  rootHidden: document.querySelector('#root')?.getAttribute('aria-hidden'),
  active: document.activeElement?.getAttribute('aria-label'),
})`);
check(report.interactions.chatDrawerOpen.count === 1 && report.interactions.chatDrawerOpen.widths[0] <= 358, 'Chat Drawer width/open state failed', report.interactions.chatDrawerOpen);
check(
  report.interactions.chatDrawerClosed.visiblePapers === 0 &&
  report.interactions.chatDrawerClosed.rootHidden === null &&
  report.interactions.chatDrawerClosed.active === chatHistoryLabel,
  'Chat Drawer did not close cleanly and restore focus',
  report.interactions.chatDrawerClosed,
);

await runGroup({
  name: '1440-dark-en',
  width: 1440,
  height: 900,
  mobile: false,
  theme: 'dark',
  locale: 'en',
  routes: REPRESENTATIVE_ROUTES.filter(([name]) => name !== 'bilibili'),
  screenshots: ['dashboard', 'chat', 'settings'],
});

await runGroup({
  name: '390-dark-en',
  width: 390,
  height: 844,
  mobile: true,
  theme: 'dark',
  locale: 'en',
  routes: REPRESENTATIVE_ROUTES.filter(([name]) => name !== 'bilibili'),
  screenshots: ['dashboard', 'chat', 'settings'],
});

await viewport(390, 844, true);
await configure({ theme: 'light', locale: 'en', reducedMotion: true });
await goto('/', { reload: true });
report.interactions.reducedMotion = await evaluate(`(async () => {
  let transitions = 0;
  const original = document.startViewTransition?.bind(document);
  if (original) document.startViewTransition = (...args) => { transitions += 1; return original(...args); };
  const input = document.querySelector('header input[type="checkbox"]');
  input?.click();
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
  return {
    transitions,
    scheme: document.documentElement.getAttribute('data-color-scheme'),
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})()`);
check(
  report.interactions.reducedMotion.reduced &&
  report.interactions.reducedMotion.transitions === 0 &&
  report.interactions.reducedMotion.scheme === 'dark',
  'Reduced-motion theme toggle contract failed',
  report.interactions.reducedMotion,
);

// CDP page scale is pinch-equivalent, not desktop browser zoom. The 390px
// layout audits above are the stricter reflow evidence; keep this limitation
// explicit instead of claiming exact desktop 200% zoom automation.
await viewport(640, 768, false);
await configure({ theme: 'light', locale: 'en' });
await goto('/settings', { reload: true });
await page('Emulation.setPageScaleFactor', { pageScaleFactor: 2 });
await sleep(300);
report.interactions.pageScale200 = await evaluate(auditExpression);
await screenshot('page-scale-200-settings-light-en');
check(report.interactions.pageScale200.visualViewport?.scale === 2, 'CDP 200% page scale was not applied', report.interactions.pageScale200.visualViewport);
report.notes.push('Exact desktop browser zoom is [UNKNOWN]: CDP pageScaleFactor is pinch-equivalent. 390px CSS viewport reflow is the normative narrow-layout evidence.');

const allErrors = runtimeEvents.filter((event) =>
  (event.level === 'error' || event.kind === 'exception') && !isExpectedHandledEvent(event),
);
report.runtimeEvents = runtimeEvents;
report.expectedRuntimeEvents = runtimeEvents.filter(isExpectedHandledEvent);
check(allErrors.length === 0, 'Runtime emitted console errors or exceptions', allErrors);
} catch (error) {
  runError = error;
  report.failures.push({ message: 'Runtime validation aborted', details: error.stack ?? error.message });
} finally {
  try {
    await restoreOriginalState();
    report.restoredOriginalPageState = true;
  } catch (error) {
    report.restoredOriginalPageState = false;
    report.failures.push({ message: 'Failed to restore the existing Chrome page', details: error.stack ?? error.message });
  }

  try {
    await cdp.send('Target.detachFromTarget', { sessionId });
  } catch (error) {
    report.failures.push({ message: 'Failed to detach from the existing Chrome page', details: error.message });
  }
  cdp.close();

  writeFileSync(join(OUTPUT, 'runtime-report.json'), JSON.stringify(report, null, 2));
  console.log(`wrote ${join(OUTPUT, 'runtime-report.json')}`);
  console.log(`failures ${report.failures.length}`);
}

if (runError) console.error(runError);
process.exit(report.failures.length === 0 ? 0 : 1);
