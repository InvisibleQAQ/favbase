import './global.css';

import { Outlet } from 'react-router-dom';

import { ThemeProvider } from './theme/theme-provider';

export default function App() {
  return (
    <ThemeProvider>
      <Outlet />
    </ThemeProvider>
  );
}
