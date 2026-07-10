import type { OpenAppPageRequest } from './messages';

/**
 * Focus an existing app.html tab (navigating it to the requested hash) or
 * create one. Mirrors the popup's open-or-focus behavior; `tabs.query` URL
 * patterns ignore fragments, so the bare page URL matches any hash route.
 */
export async function handleOpenAppPage(msg: OpenAppPageRequest): Promise<void> {
  const appUrl = browser.runtime.getURL('/app.html');
  const targetUrl = msg.hash ? `${appUrl}${msg.hash}` : appUrl;

  const tabs = await browser.tabs.query({ url: appUrl });
  if (tabs.length > 0 && tabs[0].id != null) {
    // Only navigate when a hash was requested — a bare focus must not reset
    // the tab's current hash route.
    await browser.tabs.update(tabs[0].id, msg.hash ? { active: true, url: targetUrl } : { active: true });
    if (tabs[0].windowId != null) {
      await browser.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url: targetUrl });
  }
}
