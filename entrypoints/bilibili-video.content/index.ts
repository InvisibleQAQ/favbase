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
      anchor: 'body',
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

    ui.mount();
  },
});
