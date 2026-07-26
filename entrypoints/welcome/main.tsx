import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';

import '@/entrypoints/app/global.css';
import './welcome.css';

import { ThemeProvider } from '@/entrypoints/app/theme/theme-provider';

import { WelcomeView } from './welcome-view';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      {/* reducedMotion="user" makes every motion component below honor the OS
          "reduce motion" setting: transforms stop, opacity still crossfades. */}
      <MotionConfig reducedMotion="user">
        <WelcomeView />
      </MotionConfig>
    </ThemeProvider>
  </StrictMode>
);
