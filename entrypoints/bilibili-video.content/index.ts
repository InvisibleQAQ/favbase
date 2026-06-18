import './style.css';
import { createElement } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'favbase-panel',
      position: 'inline',
      anchor: '.right-container-inner',
      append(anchor: Element, ui: Element) {
        const upPanel = anchor.querySelector('.up-panel-container');
        if (upPanel) {
          upPanel.after(ui);
        } else {
          anchor.prepend(ui);
        }
      },
      isolateEvents: true,
      onMount(uiContainer) {
        const wrapper = document.createElement('div');
        uiContainer.append(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(createElement(App));
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    // DON'T use ui.autoMount() — it fires via MutationObserver the instant
    // .right-container-inner appears in DOM, potentially during Vue's
    // render/hydration phase. Inserting foreign nodes mid-hydration corrupts
    // Vue's VDOM, causing the comment section to disappear.
    //
    // Mirror Bilitato's proven pattern: wait for full page load + 2s delay
    // so Vue has finished its initial render before we touch the DOM.
    if (document.readyState !== 'complete') {
      await new Promise<void>((resolve) => {
        window.addEventListener('load', () => resolve(), { once: true });
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      ui.mount();
    } catch {
      // Anchor not found yet — will be picked up by remount polling below.
    }

    // Handle SPA re-mounting: B站 SPA navigation may cause Vue to re-render
    // .right-container-inner, removing our injected element. Poll to detect
    // removal and re-mount with a shorter delay (Vue is already hydrated
    // after the initial load, so 1s is sufficient for route transitions).
    const REMOUNT_CHECK_MS = 500;
    const REMOUNT_DELAY_MS = 1000;
    let remounting = false;
    const remountTimer = setInterval(async () => {
      if (remounting) return;
      const host = document.querySelector('favbase-panel');
      if (host && document.contains(host)) return;

      remounting = true;
      try {
        // Wait for Vue to finish its route transition render.
        await new Promise((resolve) => setTimeout(resolve, REMOUNT_DELAY_MS));
        ui.mount();
      } catch {
        // Anchor still not present — will retry on next interval.
      } finally {
        remounting = false;
      }
    }, REMOUNT_CHECK_MS);

    ctx.onInvalidated(() => {
      clearInterval(remountTimer);
    });
  },
});
