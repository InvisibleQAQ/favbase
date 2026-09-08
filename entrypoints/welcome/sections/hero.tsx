import type { MotionValue, SpringOptions } from 'motion/react';

import { useRef, useState } from 'react';
import {
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'motion/react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { FadeIn } from '../components/fade-in';
import { MotionBox } from '../components/motion-box';
import { OrbitCore } from '../components/orbit-core';
import { ctaGlowShadow, Eyebrow, Headline } from '../components/section-shell';

/** Two slow-drifting colour blobs behind the fold. Decorative only. */
function Aurora() {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0 }}>
      <MotionBox
        animate={{ x: [0, 48, 0], y: [0, -34, 0], scale: [1, 1.14, 1] }}
        transition={{ duration: 19, repeat: Infinity, ease: 'easeInOut' }}
        sx={{
          position: 'absolute',
          top: '-14%',
          left: '-8%',
          width: 'clamp(320px, 46vw, 720px)',
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          filter: 'blur(48px)',
          background:
            'radial-gradient(circle at 50% 50%, var(--fb-welcome-aurora-a), transparent 68%)',
        }}
      />
      <MotionBox
        animate={{ x: [0, -42, 0], y: [0, 40, 0], scale: [1, 1.1, 1] }}
        transition={{ duration: 23, repeat: Infinity, ease: 'easeInOut' }}
        sx={{
          position: 'absolute',
          bottom: '-22%',
          right: '-10%',
          width: 'clamp(300px, 42vw, 660px)',
          aspectRatio: '1 / 1',
          borderRadius: '50%',
          filter: 'blur(52px)',
          background:
            'radial-gradient(circle at 50% 50%, var(--fb-welcome-aurora-b), transparent 68%)',
        }}
      />
    </Box>
  );
}

function ScrollHint({ label }: { label: string }) {
  return (
    <MotionBox
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 1.2, duration: 0.8 }}
      sx={{
        position: 'absolute',
        left: '50%',
        bottom: 28,
        transform: 'translateX(-50%)',
        display: { xs: 'none', md: 'flex' },
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        color: 'text.disabled',
      }}
    >
      <Typography variant="caption" sx={{ letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
      <MotionBox
        animate={{ y: [0, 6, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        sx={{ display: 'flex' }}
      >
        <Iconify icon="eva:arrow-ios-downward-fill" width={18} />
      </MotionBox>
    </MotionBox>
  );
}

export function Hero() {
  const { t } = useTranslation();

  const mdUp = useMediaQuery((theme) => theme.breakpoints.up('md'));
  const reduceMotion = useReducedMotion();

  const scrollProgress = useScrollPercent();

  // Parallax and fade are desktop-only (the pinned layer below is too) and are
  // dropped entirely under "reduce motion": these ride `style`-bound
  // MotionValues, which `MotionConfig reducedMotion="user"` does not reach.
  const animated = mdUp && !reduceMotion;
  const distance = animated ? scrollProgress.percent : 0;

  const y1 = useTransformY(scrollProgress.scrollY, distance * -7);
  const y2 = useTransformY(scrollProgress.scrollY, distance * -6);
  const y3 = useTransformY(scrollProgress.scrollY, distance * -5);
  const y4 = useTransformY(scrollProgress.scrollY, distance * -4);

  const opacity: MotionValue<number> = useTransform(
    scrollProgress.scrollY,
    [0, 1],
    [1, animated ? Number((1 - scrollProgress.percent / 100).toFixed(1)) : 1]
  );

  // Once the fold has scrolled past, take the whole pinned layer out of paint.
  // `opacity: 0` alone would keep Aurora's two blur(48px) discs and the orbit's
  // ~20 animated nodes compositing forever, which Minimal never pays for
  // because its hero background is static.
  const spent = animated && scrollProgress.percent >= 100;

  return (
    <Box
      ref={scrollProgress.elementRef}
      component="section"
      sx={(theme) => ({
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minHeight: '100vh',
        overflow: 'hidden',
        pb: { xs: 10, md: 14 },
        pt: 5,
        [theme.breakpoints.up('md')]: {
          display: 'block',
          height: '100vh',
          minHeight: 760,
          maxHeight: 1440,
          willChange: 'opacity',
          pt: 0,
          // Claw back the header's row so the fold is a true 100vh and nothing
          // has to hard-code its height.
          mt: 'calc(var(--layout-header-desktop-height) * -1)',
        },
      })}
    >
      <MotionBox
        style={{ opacity }}
        sx={(theme) => ({
          width: 1,
          display: 'flex',
          position: 'relative',
          flexDirection: 'column',
          transition: theme.transitions.create(['opacity']),
          [theme.breakpoints.up('md')]: {
            height: 1,
            position: 'fixed',
            maxHeight: 'inherit',
          },
          ...(spent && { visibility: 'hidden' }),
        })}
      >
        <Aurora />

        <Container
          maxWidth="lg"
          sx={(theme) => ({
            position: 'relative',
            zIndex: 1,
            [theme.breakpoints.up('md')]: {
              flex: '1 1 auto',
              // Column, not row: the Grid inside is the single child and must
              // keep its full width. As a row-flex item it would shrink to its
              // content, the 7/5 split would be recomputed against that, and
              // the orbit's absolutely positioned chips (fixed 168px radius)
              // would spill over the copy. Minimal's own hero container is a
              // column too — it just has no split to preserve.
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              py: 'var(--layout-header-desktop-height)',
            },
          })}
        >
        <Grid container spacing={{ xs: 7, md: 4 }} sx={{ alignItems: 'center' }}>
          <Grid size={{ xs: 12, md: 7 }}>
            <MotionBox style={{ y: y1 }}>
            <FadeIn y={-14} duration={0.6}>
              <Eyebrow>{t('welcome.hero.eyebrow')}</Eyebrow>
            </FadeIn>

            {/* One h1 for the whole title. Each line keeps its own reveal
                mask and its own gradient clip — moving the gradient up to the
                h1 would stretch it across both lines (and background-clip:text
                glitches over transformed children). */}
            <Box component="h1" sx={{ m: 0, mt: 3 }}>
              <FadeIn
                component="span"
                delay={0.1}
                y={38}
                sx={{ display: 'block', overflow: 'hidden' }}
              >
                <Headline component="span" size="hero" sx={{ display: 'block' }}>
                  {t('welcome.hero.titleLine1')}
                </Headline>
              </FadeIn>
              <FadeIn
                component="span"
                delay={0.2}
                y={38}
                sx={{ display: 'block', overflow: 'hidden' }}
              >
                <Headline component="span" size="hero" sx={{ display: 'block' }}>
                  {t('welcome.hero.titleLine2')}
                </Headline>
              </FadeIn>
            </Box>
            </MotionBox>

            <MotionBox style={{ y: y2 }}>
            <FadeIn delay={0.34}>
              <Typography
                sx={{
                  mt: 3,
                  maxWidth: 520,
                  color: 'text.secondary',
                  fontSize: { xs: 15, md: 17 },
                  lineHeight: 1.7,
                  textWrap: 'pretty',
                }}
              >
                {t('welcome.hero.subtitle')}
              </Typography>
            </FadeIn>
            </MotionBox>

            <MotionBox style={{ y: y3 }}>
            <FadeIn
              delay={0.46}
              sx={{ mt: 4.5, display: 'flex', flexWrap: 'wrap', gap: 1.5 }}
            >
              <Button
                href="#welcome-picker"
                variant="contained"
                size="large"
                endIcon={<Iconify icon="eva:arrow-ios-forward-fill" width={18} />}
                sx={(theme) => ({ px: 3, boxShadow: ctaGlowShadow(theme) })}
              >
                {t('welcome.hero.ctaPrimary')}
              </Button>
              <Button
                href="#welcome-flow"
                variant="outlined"
                color="inherit"
                size="large"
                sx={{ px: 3 }}
              >
                {t('welcome.hero.ctaSecondary')}
              </Button>
            </FadeIn>
            </MotionBox>
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <MotionBox style={{ y: y4 }}>
              <FadeIn delay={0.3} duration={0.9} y={40}>
                <OrbitCore />
              </FadeIn>
            </MotionBox>
          </Grid>
        </Grid>
        </Container>

        <ScrollHint label={t('welcome.scrollHint')} />
      </MotionBox>
    </Box>
  );
}

/**
 * Spring-smoothed parallax offset. Ported from Minimal's hero — the spring is
 * what keeps a scroll-linked transform from looking mechanical.
 */
function useTransformY(value: MotionValue<number>, distance: number) {
  const physics: SpringOptions = {
    mass: 0.1,
    damping: 20,
    stiffness: 300,
    restDelta: 0.001,
  };

  return useSpring(useTransform(value, [0, 1], [0, distance]), physics);
}

/**
 * How far the fold has scrolled, 0-100. `Math.floor` is load-bearing: it turns
 * every scroll frame into at most one state change per whole percent, so this
 * re-renders ~100 times across the fold rather than once per frame.
 */
function useScrollPercent() {
  const elementRef = useRef<HTMLDivElement>(null);

  const { scrollY } = useScroll();

  const [percent, setPercent] = useState(0);

  useMotionValueEvent(scrollY, 'change', (scrollHeight) => {
    const heroHeight = elementRef.current?.offsetHeight ?? 0;

    if (!heroHeight) {
      return;
    }

    const scrollPercent = Math.floor((scrollHeight / heroHeight) * 100);

    setPercent(scrollPercent >= 100 ? 100 : scrollPercent);
  });

  return { elementRef, percent, scrollY };
}
