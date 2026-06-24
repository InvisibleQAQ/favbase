/**
 * PortBridge: bidirectional Chrome Port relay for DB RPC.
 *
 * app.html --[Port]--> Background SW (this bridge) --[Port]--> Offscreen (RPC Handler)
 *
 * Extension Pages cannot call chrome.offscreen APIs, so Background SW acts as
 * both the relay and the Offscreen lifecycle manager.
 */

const OFFSCREEN_BACKOFF_INIT_MS = 200;
const OFFSCREEN_BACKOFF_MAX_MS = 5_000;
const OFFSCREEN_MAX_RETRIES = 20;

interface BridgeEntry {
  callerPort: chrome.runtime.Port;
  offscreenPort: chrome.runtime.Port;
}

/**
 * Initialize the PortBridge. Must be called synchronously at module load time
 * so the onConnect listener is registered before any connection attempts
 * (MV3 Service Worker requirement).
 */
export function initPortBridge(
  channelName: string,
  ensureOffscreen: () => Promise<void>,
): void {
  const bridges = new Map<string, BridgeEntry>();

  chrome.runtime.onConnect.addListener((callerPort) => {
    if (callerPort.name !== channelName) return;

    // Ignore connections from Background SW itself (no sender) or from
    // other content scripts that happen to use the same channel name.
    // Extension Pages (app.html) have sender.url starting with chrome-extension://
    if (!callerPort.sender?.url) return;

    // Only relay connections originating from our own extension pages
    const extOrigin = `chrome-extension://${chrome.runtime.id}`;
    if (!callerPort.sender.url.startsWith(extOrigin)) return;

    // Ensure Offscreen is alive, then create the relay
    ensureOffscreen()
      .then(() => {
        if (!callerPort.name) return; // caller already disconnected

        const offscreenPort = chrome.runtime.connect({ name: channelName });
        const bridgeId = `${channelName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        bridges.set(bridgeId, { callerPort, offscreenPort });

        setupRelay(bridges, bridgeId, callerPort, offscreenPort, channelName);
      })
      .catch((err) => {
        console.error('[port-bridge] Failed to ensure offscreen:', err);
        try { callerPort.disconnect(); } catch { /* already gone */ }
      });
  });
}

function setupRelay(
  bridges: Map<string, BridgeEntry>,
  bridgeId: string,
  callerPort: chrome.runtime.Port,
  initialOffscreenPort: chrome.runtime.Port,
  channelName: string,
): void {
  let currentOffscreenPort = initialOffscreenPort;
  let callerDisconnected = false;

  // caller -> offscreen
  const relayToOffscreen = (message: unknown) => {
    try {
      currentOffscreenPort.postMessage(message);
    } catch {
      // offscreen port dead; retry will handle reconnection
    }
  };
  callerPort.onMessage.addListener(relayToOffscreen);

  // offscreen -> caller
  const relayToCaller = (message: unknown) => {
    try {
      callerPort.postMessage(message);
    } catch {
      // caller port dead; onDisconnect will clean up
    }
  };

  // Clean up when caller disconnects
  callerPort.onDisconnect.addListener(() => {
    callerDisconnected = true;
    try { currentOffscreenPort.disconnect(); } catch { /* already gone */ }
    bridges.delete(bridgeId);
  });

  // Attach offscreen port listeners with retry on disconnect
  const attachOffscreen = (oPort: chrome.runtime.Port, attempt: number) => {
    oPort.onMessage.addListener(relayToCaller);

    oPort.onDisconnect.addListener(() => {
      if (callerDisconnected) return;

      if (attempt >= OFFSCREEN_MAX_RETRIES) {
        console.error('[port-bridge] Max offscreen retries reached, dropping bridge', bridgeId);
        try { callerPort.disconnect(); } catch { /* already gone */ }
        bridges.delete(bridgeId);
        return;
      }

      const delay = Math.min(
        OFFSCREEN_BACKOFF_INIT_MS * Math.pow(2, attempt),
        OFFSCREEN_BACKOFF_MAX_MS,
      );

      setTimeout(() => {
        if (callerDisconnected) return;
        try {
          const newPort = chrome.runtime.connect({ name: channelName });
          currentOffscreenPort = newPort;
          bridges.set(bridgeId, { callerPort, offscreenPort: newPort });
          attachOffscreen(newPort, attempt + 1);
        } catch (err) {
          console.error('[port-bridge] Reconnect to offscreen failed:', err);
          try { callerPort.disconnect(); } catch { /* already gone */ }
          bridges.delete(bridgeId);
        }
      }, delay);
    });
  };

  attachOffscreen(initialOffscreenPort, 0);
}
