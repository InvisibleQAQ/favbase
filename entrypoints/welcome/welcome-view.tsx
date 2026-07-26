import { useScroll } from 'motion/react';

import Box from '@mui/material/Box';

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
