let pending: Promise<void> | null = null;

async function doEnsure(): Promise<void> {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('/offscreen.html'),
      reasons: ['WORKERS'],
      justification: 'FFmpeg WASM audio chunking + PGlite database host',
    });
  }
}

export function ensure(): Promise<void> {
  if (!pending) {
    pending = doEnsure().finally(() => {
      pending = null;
    });
  }
  return pending;
}
