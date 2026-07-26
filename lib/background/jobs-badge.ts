// The toolbar jobs badge is WRITTEN by app.html (entrypoints/app/hooks/
// use-jobs-badge.ts) — jobs live and die with that page. Badge text, however,
// persists for the whole browser session, so a badge left behind by a closed
// page would lie until browser restart. The SW owns exactly one move: wipe
// badge + title whenever no app.html tab remains.

/**
 * Clear badge and hover title iff no app.html tab is open. `closedTabId`
 * excludes the tab currently being removed: during tabs.onRemoved the closing
 * tab can still appear in tabs.query, which would veto the wipe exactly when
 * the last app tab closes.
 */
export async function sweepJobsBadge(closedTabId?: number): Promise<void> {
  const appTabs = await browser.tabs.query({
    url: browser.runtime.getURL('/app.html'),
  });
  if (appTabs.some((tab) => tab.id !== closedTabId)) return;

  await browser.action.setBadgeText({ text: '' });
  await browser.action.setTitle({ title: '' });
}

/**
 * Register the janitor: sweep on every tab removal, plus once at SW start —
 * the cold-start sweep covers the page having closed while the SW slept
 * (nobody saw the tab go).
 */
export function initJobsBadgeJanitor(): void {
  const sweep = (closedTabId?: number): void => {
    sweepJobsBadge(closedTabId).catch((err) =>
      console.warn('[jobs-badge] sweep failed:', err),
    );
  };

  browser.tabs.onRemoved.addListener((tabId) => sweep(tabId));
  sweep();
}
