import type { BackgroundContext } from '@/lib/background/types';
import { initCacheStorageListener } from '@/lib/cache/video-cache';
import { ensure as ensureOffscreen } from '@/lib/offscreen/lifecycle';
import { initPortBridge } from '@/lib/background/port-bridge';
import { DB_CHANNEL_NAME } from '@/lib/database/constants';
import { runStorageMigrations } from '@/lib/storage';
import { createJobRegistry } from '@/lib/background/job-registry';
import { openWelcomePage } from '@/lib/background/app-handlers';
import { initJobsBadgeJanitor } from '@/lib/background/jobs-badge';
import { initWebdavSyncScheduler } from '@/lib/sync';
import { captureXTokens } from '@/lib/x/x-auth';
import { dispatchBackgroundMessage } from '@/lib/background/dispatcher';
import { routeBackgroundMessage } from '@/lib/background/routes';
import { encodeBackgroundPush } from '@/lib/background/message-protocol';
import { AgentBridgeClient } from '@/lib/agent-bridge/client';
import { initAgentBridgeScheduler } from '@/lib/agent-bridge/scheduler';
import { initReadDbProxy } from '@/lib/database/read-proxy-db';

function createBackgroundContext(connectAgentBridge: () => Promise<void>): BackgroundContext {
  const transcription = createJobRegistry();
  const summary = createJobRegistry();
  const sessionTabMap = new Map<string, number>();

  return {
    sendToTab(tabId, message) {
      const encoded = encodeBackgroundPush(message);
      if (!encoded) return;
      browser.tabs.sendMessage(tabId, encoded).catch(() => {});
    },
    ensureOffscreen,
    connectAgentBridge,

    startTranscription: transcription.start,
    abortTranscription: transcription.abort,
    finishTranscription: transcription.finish,
    getVideoIdForTab: transcription.getVideoId,

    startSummary: summary.start,
    abortSummary: summary.abort,
    finishSummary: summary.finish,

    registerChunkSession(sessionId, tabId) {
      sessionTabMap.set(sessionId, tabId);
    },

    unregisterChunkSession(sessionId) {
      sessionTabMap.delete(sessionId);
    },

    resolveProgressTarget(sessionId) {
      const tabId = sessionTabMap.get(sessionId);
      if (tabId === undefined) return null;
      return { tabId, videoId: transcription.getVideoId(tabId) ?? '' };
    },
  };
}

export default defineBackground(() => {
  initPortBridge(DB_CHANNEL_NAME, ensureOffscreen);

  const agentBridgeClient = new AgentBridgeClient({
    getDb: () => initReadDbProxy(ensureOffscreen),
  });
  const agentBridgeScheduler = initAgentBridgeScheduler(agentBridgeClient);

  initCacheStorageListener();

  // WebDAV sync scheduler: alarms + settings/locale watch + startup catch-up.
  // Registers its listeners synchronously so the SW can be woken by them.
  initWebdavSyncScheduler();

  // Jobs-badge janitor: app.html writes the badge, the SW wipes it once the
  // last app tab is gone (badge text would otherwise outlive the jobs).
  initJobsBadgeJanitor();

  // Capture X (Twitter) auth headers from the logged-in web client's own
  // requests (observational webRequest — returns nothing). x-api.ts replays
  // them verbatim to read bookmarks; see lib/x/x-auth.ts. host_permission for
  // x.com is required for the headers to be visible.
  browser.webRequest.onBeforeSendHeaders.addListener(
    (details) => {
      captureXTokens(details)
        .then((captured) => {
          // One log per (deduped) token set — diagnoses "no-token" sync errors:
          // if this never appears, the capture chain itself is broken.
          if (captured) console.log('[favbase x-auth] captured X session headers');
        })
        .catch((err) => console.warn('[favbase x-auth] token capture failed:', err));
      return undefined;
    },
    { urls: ['*://x.com/*'] },
    ['requestHeaders', 'extraHeaders'],
  );

  const ctx = createBackgroundContext(agentBridgeScheduler.connectNow);

  browser.runtime.onMessage.addListener(
    (msg: unknown, sender) => dispatchBackgroundMessage(msg, sender, ctx, routeBackgroundMessage),
  );

  chrome.runtime.onInstalled.addListener((details) => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onInstalled: ensureOffscreen failed', err),
    );
    runStorageMigrations().catch((err) =>
      console.error('[background] onInstalled: storage migration failed', err),
    );
    // First run only: introduce the product and let the user pick platforms.
    // Self-gated on the onboarding record (see openWelcomePage).
    if (details.reason === 'install') {
      openWelcomePage().catch((err) =>
        console.error('[background] onInstalled: open welcome failed', err),
      );
    }
  });
  chrome.runtime.onStartup.addListener(() => {
    ensureOffscreen().catch((err) =>
      console.error('[background] onStartup: ensureOffscreen failed', err),
    );
    runStorageMigrations().catch((err) =>
      console.error('[background] onStartup: storage migration failed', err),
    );
  });

  if (import.meta.env.VITE_AGENT_BRIDGE_SPIKE === '1') {
    void import('@/spikes/agent-bridge/background-spike')
      .then(({ runAgentBridgePhase0Spike }) => runAgentBridgePhase0Spike())
      .catch((err) =>
        console.error('[agent-bridge:phase-0] unhandled spike failure', err),
      );
  }

  console.log('favbase background ready', { id: browser.runtime.id });
});
