import { createState } from '@/lib/bilibili/inject/state';
import { installInterceptors } from '@/lib/bilibili/inject/subtitle-interceptor';
import { scheduleAutoTriggerFlow } from '@/lib/bilibili/inject/cc-trigger';
import { emitInitialHandshake, startRouteMonitor, startReemitLoop } from '@/lib/bilibili/inject/route-monitor';

export default defineContentScript({
  matches: ['*://*.bilibili.com/video/*'],
  world: 'MAIN',
  runAt: 'document_start',

  main() {
    if ((window as any).__FAVBASE_INJECT_READY__) return;
    (window as any).__FAVBASE_INJECT_READY__ = true;

    const state = createState();
    installInterceptors(state);

    function bootstrap(): void {
      emitInitialHandshake(state);
      scheduleAutoTriggerFlow(state);
      startRouteMonitor(state);
      startReemitLoop(state);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
      bootstrap();
    }
  },
});
