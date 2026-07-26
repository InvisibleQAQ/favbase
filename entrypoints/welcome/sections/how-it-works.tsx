import type { MotionValue } from 'motion/react';
import type { LocaleKeys } from '@/lib/i18n';
import type { IconifyName } from '@/entrypoints/app/components/iconify';

import { useRef } from 'react';
import { useReducedMotion, useScroll, useTransform } from 'motion/react';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { FadeIn } from '../components/fade-in';
import { MotionBox } from '../components/motion-box';
import { AnimatedText } from '../components/animated-text';
import { Eyebrow, Headline } from '../components/section-shell';

type StepGlyphVariant = 'rows' | 'grid' | 'bubble';

interface Step {
  number: string;
  titleKey: LocaleKeys;
  descKey: LocaleKeys;
  hintKey: LocaleKeys;
  icon: IconifyName;
  glyph: StepGlyphVariant;
}

const STEPS: Step[] = [
  {
    number: '01',
    titleKey: 'welcome.flow.step1.title',
    descKey: 'welcome.flow.step1.desc',
    hintKey: 'welcome.flow.step1.hint',
    icon: 'solar:bookmark-bold-duotone',
    glyph: 'rows',
  },
  {
    number: '02',
    titleKey: 'welcome.flow.step2.title',
    descKey: 'welcome.flow.step2.desc',
    hintKey: 'welcome.flow.step2.hint',
    icon: 'solar:database-bold-duotone',
    glyph: 'grid',
  },
  {
    number: '03',
    titleKey: 'welcome.flow.step3.title',
    descKey: 'welcome.flow.step3.desc',
    hintKey: 'welcome.flow.step3.hint',
    icon: 'solar:chat-round-dots-bold',
    glyph: 'bubble',
  },
];

/** Abstract, per-step decoration. Cheap DOM, no assets, reveals on entry. */
function StepGlyph({ variant }: { variant: StepGlyphVariant }) {
  if (variant === 'rows') {
    return (
      <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {[1, 0.78, 0.9, 0.62].map((width, i) => (
          <MotionBox
            key={i}
            initial={{ opacity: 0, x: -24 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 + i * 0.1, duration: 0.55 }}
            sx={{ display: 'flex', alignItems: 'center', gap: 1.25, width: `${width * 100}%` }}
          >
            <Box
              sx={(theme) => ({
                width: 22,
                height: 22,
                flexShrink: 0,
                borderRadius: 1,
                bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.24),
              })}
            />
            <Box
              sx={(theme) => ({
                height: 8,
                flex: 1,
                borderRadius: 999,
                bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.2),
              })}
            />
          </MotionBox>
        ))}
      </Box>
    );
  }

  if (variant === 'grid') {
    // A body chunked into cells; the coral ones stand for embedded vectors.
    const cells = Array.from({ length: 24 });
    return (
      <Box
        aria-hidden
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: 0.75 }}
      >
        {cells.map((_, i) => (
          <MotionBox
            key={i}
            initial={{ opacity: 0, scale: 0.5 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 + i * 0.025, duration: 0.4 }}
            sx={(theme) => ({
              aspectRatio: '1 / 1',
              borderRadius: 0.75,
              bgcolor:
                i % 3 === 0
                  ? varAlpha(theme.vars.palette.primary.mainChannel, 0.6)
                  : varAlpha(theme.vars.palette.grey['500Channel'], 0.18),
            })}
          />
        ))}
      </Box>
    );
  }

  return (
    <Box aria-hidden sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {[
        { align: 'flex-end', width: '58%', tinted: false },
        { align: 'flex-start', width: '84%', tinted: true },
      ].map((bubble, i) => (
        <MotionBox
          key={i}
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 + i * 0.25, duration: 0.5 }}
          sx={(theme) => ({
            alignSelf: bubble.align,
            width: bubble.width,
            p: 1.5,
            borderRadius: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
            bgcolor: bubble.tinted
              ? varAlpha(theme.vars.palette.primary.mainChannel, 0.12)
              : varAlpha(theme.vars.palette.grey['500Channel'], 0.12),
          })}
        >
          {[1, 0.72].map((width, line) => (
            <Box
              key={line}
              sx={(theme) => ({
                height: 7,
                width: `${width * 100}%`,
                borderRadius: 999,
                bgcolor: bubble.tinted
                  ? varAlpha(theme.vars.palette.primary.mainChannel, 0.45)
                  : varAlpha(theme.vars.palette.grey['500Channel'], 0.32),
              })}
            />
          ))}
        </MotionBox>
      ))}
    </Box>
  );
}

function StickyStep({
  step,
  index,
  total,
  progress,
}: {
  step: Step;
  index: number;
  total: number;
  progress: MotionValue<number>;
}) {
  const { t } = useTranslation();
  // Style-bound MotionValues bypass MotionConfig's reducedMotion, so the
  // depth-scale is gated by hand (cards simply stack at full size).
  const reduceMotion = useReducedMotion();

  // Cards below the top of the stack shrink as later ones slide over them, so
  // the stack reads as depth rather than a flat cut.
  const targetScale = 1 - (total - 1 - index) * 0.04;
  const scale = useTransform(progress, [index / total, 1], [1, targetScale]);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'center',
        mb: { xs: 3, md: 0 },
        height: { md: '84vh' },
        position: { md: 'sticky' },
        top: { md: 104 + index * 26 },
      }}
    >
      <MotionBox
        style={reduceMotion ? undefined : { scale }}
        sx={(theme) => ({
          width: 1,
          maxWidth: 940,
          p: { xs: 3, md: 5 },
          borderRadius: '28px',
          bgcolor: 'background.paper',
          border: `1px solid ${theme.vars.palette.divider}`,
          boxShadow: theme.vars.customShadows.card,
        })}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' },
            gap: { xs: 3, md: 6 },
            alignItems: { md: 'center' },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Box
                className="fb-headline"
                sx={(theme) => ({
                  fontFamily: theme.typography.fontSecondaryFamily,
                  fontWeight: 800,
                  lineHeight: 1,
                  letterSpacing: '-0.04em',
                  fontSize: 'clamp(3rem, 7vw, 5.5rem)',
                })}
              >
                {step.number}
              </Box>
              <Box
                sx={(theme) => ({
                  width: 48,
                  height: 48,
                  borderRadius: '30%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'primary.main',
                  bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
                })}
              >
                <Iconify icon={step.icon} width={26} />
              </Box>
            </Box>

            <Typography variant="h3" sx={{ mt: 1.5 }}>
              {t(step.titleKey)}
            </Typography>

            <Typography
              sx={{
                mt: 2,
                maxWidth: 520,
                color: 'text.secondary',
                lineHeight: 1.75,
                textWrap: 'pretty',
              }}
            >
              {t(step.descKey)}
            </Typography>

            <Box sx={{ mt: 3 }}>
              <Eyebrow icon="eva:checkmark-fill">{t(step.hintKey)}</Eyebrow>
            </Box>
          </Box>

          <Box
            sx={(theme) => ({
              width: { xs: 1, md: 300 },
              flexShrink: 0,
              p: { xs: 2.5, md: 3 },
              borderRadius: '20px',
              bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.06),
              border: `1px solid ${theme.vars.palette.divider}`,
            })}
          >
            <StepGlyph variant={step.glyph} />
          </Box>
        </Box>
      </MotionBox>
    </Box>
  );
}

export function HowItWorks() {
  const { t } = useTranslation();
  const stackRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: stackRef,
    offset: ['start start', 'end end'],
  });

  return (
    <Box
      id="welcome-flow"
      component="section"
      sx={{ position: 'relative', pt: { xs: 8, md: 12 }, scrollMarginTop: 80 }}
    >
      <Container maxWidth="lg">
        <Box sx={{ maxWidth: 760 }}>
          <FadeIn y={-12}>
            <Eyebrow>{t('welcome.flow.eyebrow')}</Eyebrow>
          </FadeIn>
          <FadeIn delay={0.08} sx={{ mt: 2.5 }}>
            <Headline>{t('welcome.flow.heading')}</Headline>
          </FadeIn>
          <AnimatedText
            text={t('welcome.flow.intro')}
            sx={{
              mt: 3,
              fontSize: { xs: 16, md: 20 },
              lineHeight: 1.7,
              fontWeight: 500,
            }}
          />
        </Box>
      </Container>

      <Container maxWidth="lg" sx={{ mt: { xs: 6, md: 8 } }}>
        <Box ref={stackRef}>
          {STEPS.map((step, index) => (
            <StickyStep
              key={step.number}
              step={step}
              index={index}
              total={STEPS.length}
              progress={scrollYProgress}
            />
          ))}
        </Box>
      </Container>
    </Box>
  );
}
