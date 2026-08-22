import './global.css';

import { Outlet } from 'react-router-dom';

import { AUTO_SYNC_PLATFORMS } from './collection-platform-auto-sync';
import { useDailyAutoSync } from './hooks/use-daily-auto-sync';
import { ThemeProvider } from './theme/theme-provider';

export default function App() {
  // Daily first-open auto-sync for all ready platforms (mount + tab visible).
  // The app root owns the platform registry; the hook only consumes it.
  useDailyAutoSync(AUTO_SYNC_PLATFORMS);

  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}
