import { useEffect } from 'react';

import Box from '@mui/material/Box';

import { useTranslation } from '@/lib/i18n/use-translation';

import { WelcomeLayout } from './layout';
import { Hero } from './sections/hero';
import { ChatShowcase } from './sections/chat-showcase';
import { HowItWorks } from './sections/how-it-works';
import { PlatformPicker } from './sections/platform-picker';
import { PlatformRequest } from './sections/platform-request';
import { CapabilityMarquee } from './sections/capability-marquee';
import { BilibiliShowcase } from './sections/bilibili-showcase';

export function WelcomeView() {
  const { locale } = useTranslation();

  // Keep <html lang> in step with the live locale (screen readers pick
  // pronunciation rules from it; index.html ships a zh-CN default). This stays
  // local to the welcome entry on purpose — lib/i18n is shared with content
  // scripts, which must never touch the HOST page's lang.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <WelcomeLayout>
      <Hero />

      {/* Everything after the fold needs its own stacking context and an
          opaque ground: the hero's inner layer is `position: fixed` on desktop,
          so without this it would float over the bands below. Mirrors
          Minimal's `HomeView`, which wraps its ten remaining sections the same
          way. */}
      <Box sx={{ position: 'relative', bgcolor: 'background.default' }}>
        <CapabilityMarquee />
        <HowItWorks />
        <ChatShowcase />
        <BilibiliShowcase />
        <PlatformPicker />
        <PlatformRequest />
      </Box>
    </WelcomeLayout>
  );
}
