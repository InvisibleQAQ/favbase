import { createStateMachine } from '@/lib/bilibili/inject/state';
import { createBrowserEffects } from '@/lib/bilibili/inject/effects';
import { installInterceptors } from '@/lib/bilibili/inject/interceptors';
import { startRouteMonitor } from '@/lib/bilibili/inject/route-monitor';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    if ((window as any).__FAVBASE_INJECT_READY__) return;
    (window as any).__FAVBASE_INJECT_READY__ = true;

    const effects = createBrowserEffects();
    const sm = createStateMachine(effects);
    installInterceptors(sm);

    function bootstrap(): void {
      sm.bootstrap();
      startRouteMonitor(sm);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      bootstrap();
    }
  },
});
