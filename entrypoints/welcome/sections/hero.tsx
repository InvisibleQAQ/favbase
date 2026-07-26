import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { FadeIn } from '../components/fade-in';
import { MotionBox } from '../components/motion-box';
import { OrbitCore } from '../components/orbit-core';
import { ctaGlowShadow, Eyebrow, Headline } from '../components/section-shell';
import { TOP_BAR_HEIGHT } from './top-bar';

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

  return (
    <Box
      component="section"
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        minHeight: '100vh',
        overflow: 'hidden',
        pt: `${TOP_BAR_HEIGHT + 40}px`,
        pb: { xs: 10, md: 14 },
      }}
    >
      <Aurora />

      <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 1 }}>
        <Grid container spacing={{ xs: 7, md: 4 }} alignItems="center">
          <Grid size={{ xs: 12, md: 7 }}>
            <FadeIn y={-14} duration={0.6}>
              <Eyebrow>{t('welcome.hero.eyebrow')}</Eyebrow>
            </FadeIn>

            {/* One h1 for the whole title. Each line keeps its own reveal
                mask and its own per-line `.fb-headline` clip — moving the
                gradient up to the h1 would stretch it across both lines (and
                background-clip:text glitches over transformed children). */}
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
          </Grid>

          <Grid size={{ xs: 12, md: 5 }}>
            <FadeIn delay={0.3} duration={0.9} y={40}>
              <OrbitCore />
            </FadeIn>
          </Grid>
        </Grid>
      </Container>

      <ScrollHint label={t('welcome.scrollHint')} />
    </Box>
  );
}
