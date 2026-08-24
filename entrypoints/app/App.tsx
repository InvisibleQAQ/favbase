import './global.css';

import { useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';

import { sendBackgroundMessage } from '@/lib/background/client';
import { AUTO_SYNC_PLATFORMS } from './collection-platform-auto-sync';
import { useDailyAutoSync } from './hooks/use-daily-auto-sync';
import { ThemeProvider } from './theme/theme-provider';

export default function App() {
  const requestedAgentBridgeConnection = useRef(false);
  // Daily first-open auto-sync for all ready platforms (mount + tab visible).
  // The app root owns the platform registry; the hook only consumes it.
  useDailyAutoSync(AUTO_SYNC_PLATFORMS);

  useEffect(() => {
    if (requestedAgentBridgeConnection.current) return;
    requestedAgentBridgeConnection.current = true;
    // Background owns enablement, backoff, and the socket. Opening app.html only
    // asks it to skip the next 30-second poll when a connection is eligible.
    void sendBackgroundMessage({ type: 'AGENT_BRIDGE_CONNECT_NOW' }).catch((error) => {
      console.error('[Agent Bridge] Immediate connection request failed', error);
    });
  }, []);

  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}
