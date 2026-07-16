import './style.css';
import { createElement } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

/**
 * X (Twitter) bookmarks page floating button. Injects a persistent bottom-right
 * "fetch bookmarks" pill on x.com; clicking it delegates the whole sync to the
 * Offscreen document via the background SW (the button can't reach PGlite or the
 * captured auth itself — see lib/x/x-messages.ts). Mirrors supermemory's on-page
 * import UX but drives favbase's local-first `syncBookmarks` path.
 *
 * The shadow host mounts once on any x.com page; <App/> renders the button only
 * while on `/i/bookmarks` (route tracked via wxt:locationchange in the App), so
 * we avoid the remove/remount fragility of a heavy React SPA.
 */
export default defineContentScript({
  matches: ['*://x.com/*'],
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'favbase-x-fab',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      isolateEvents: true,
      onMount(container) {
        const wrapper = document.createElement('div');
        container.append(wrapper);
        const root = ReactDOM.createRoot(wrapper);
        root.render(createElement(App));
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();
  },
});
