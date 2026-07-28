import type { OpenAppPageRequest } from './messages';
import { onboardingStorage } from '@/lib/storage';

/**
 * Focus the extension tab already showing `pageUrl`, or create one.
 *
 * `tabs.query` URL patterns ignore fragments, so the bare page URL matches the
 * tab whatever hash route it currently sits on. `navigateTo` is applied only
 * when given — a bare focus must not reset that route.
 *
 * Activating a tab is invisible while its window sits behind others, so the
 * window gets raised too.
 */
async function focusOrCreateTab(pageUrl: string, navigateTo?: string): Promise<void> {
  const [existing] = await browser.tabs.query({ url: pageUrl });

  if (existing?.id != null) {
    await browser.tabs.update(
      existing.id,
      navigateTo ? { active: true, url: navigateTo } : { active: true }
    );
    if (existing.windowId != null) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    return;
  }

  await browser.tabs.create({ url: navigateTo ?? pageUrl });
}

/**
 * Open or focus app.html, optionally navigating it to `msg.hash` (e.g.
 * `'#/settings'`). Mirrors the popup's open-or-focus behavior.
 */
export async function handleOpenAppPage(msg: OpenAppPageRequest): Promise<void> {
  const appUrl = browser.runtime.getURL('/app.html');
  await focusOrCreateTab(appUrl, msg.hash ? `${appUrl}${msg.hash}` : undefined);
}

/**
 * Open the first-run welcome page (welcome.html), at most once per profile.
 *
 * `onInstalled` reports reason 'install' for a fresh install *and* for every
 * reload of an unpacked extension, so the reason alone would re-open the tab
 * all through development. The onboarding record is the real gate: once the
 * user has completed the flow, with or without picks, this becomes a no-op.
 */
export async function openWelcomePage(): Promise<void> {
  if (await onboardingStorage.getValue()) return;

  await focusOrCreateTab(browser.runtime.getURL('/welcome.html'));
}
