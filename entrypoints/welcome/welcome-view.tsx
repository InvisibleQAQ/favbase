import { useEffect } from 'react';
import { useScroll } from 'motion/react';

import Box from '@mui/material/Box';

import { useTranslation } from '@/lib/i18n/use-translation';

import { MotionBox } from './components/motion-box';
import { Hero } from './sections/hero';
import { TopBar } from './sections/top-bar';
import { ChatShowcase } from './sections/chat-showcase';
import { HowItWorks } from './sections/how-it-works';
import { PlatformPicker } from './sections/platform-picker';
import { CapabilityMarquee } from './sections/capability-marquee';
import { BilibiliShowcase } from './sections/bilibili-showcase';
import { useOnboardingExit } from './use-onboarding-exit';

/** Hairline reading indicator above the header. */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();

  return (
    <MotionBox
      aria-hidden
      style={{ scaleX: scrollYProgress }}
      sx={{
        position: 'fixed',
        inset: '0 0 auto 0',
        zIndex: 30,
        height: 3,
        transformOrigin: '0% 50%',
        bgcolor: 'primary.main',
      }}
    />
  );
}

export function WelcomeView() {
  // Header "skip" leaves with no picks — the record still gets written, so the
  // install-time tab does not come back.
  const { exit } = useOnboardingExit();
  const { locale } = useTranslation();

  // Keep <html lang> in step with the live locale (screen readers pick
  // pronunciation rules from it; index.html ships a zh-CN default). This stays
  // local to the welcome entry on purpose — lib/i18n is shared with content
  // scripts, which must never touch the HOST page's lang.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <Box sx={{ position: 'relative', overflowX: 'clip', bgcolor: 'background.default' }}>
      <ScrollProgress />
      <TopBar onSkip={() => exit([])} />

      <Hero />
      <CapabilityMarquee />
      <HowItWorks />
      <ChatShowcase />
      <BilibiliShowcase />
      <PlatformPicker />
    </Box>
  );
}
