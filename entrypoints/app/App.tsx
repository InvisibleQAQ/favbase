import './global.css';

import { Outlet } from 'react-router-dom';

import { useDailyAutoSync } from './hooks/use-daily-auto-sync';
import { ThemeProvider } from './theme/theme-provider';

export default function App() {
  // Daily first-open auto-sync for all ready platforms (mount + tab visible).
  useDailyAutoSync();

  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}
