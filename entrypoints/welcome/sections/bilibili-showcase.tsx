import type { LocaleKeys } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, useInView, useReducedMotion } from 'motion/react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { FadeIn } from '../components/fade-in';
import { MotionBox } from '../components/motion-box';
import { FeatureList } from '../components/feature-list';
import { Eyebrow, Headline, WelcomeSection } from '../components/section-shell';

const FEATURES: LocaleKeys[] = [
  'welcome.bilibili.feature1',
  'welcome.bilibili.feature2',
  'welcome.bilibili.feature3',
];

const SUBTITLE_LINES: { time: string; textKey: LocaleKeys }[] = [
  { time: '0:42', textKey: 'welcome.bilibili.line1' },
  { time: '1:08', textKey: 'welcome.bilibili.line2' },
  { time: '2:31', textKey: 'welcome.bilibili.line3' },
];

const CHAPTERS: { time: string; textKey: LocaleKeys; ad?: boolean }[] = [
  { time: '0:00', textKey: 'welcome.bilibili.chapter1' },
  { time: '1:05', textKey: 'welcome.bilibili.chapter2' },
  { time: '4:12', textKey: 'welcome.bilibili.chapter3', ad: true },
];

type PanelTab = 'subtitle' | 'summary';

function TabButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: 'solar:subtitles-bold-duotone' | 'solar:magic-stick-3-bold-duotone';
  onClick: () => void;
}) {
  return (
    <ButtonBase
      role="tab"
      aria-selected={active}
      onClick={onClick}
      sx={(theme) => ({
        position: 'relative',
        flex: 1,
        gap: 0.75,
        py: 1,
        borderRadius: 1.5,
        fontSize: 13,
        fontWeight: 600,
        color: active ? 'primary.main' : 'text.secondary',
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.vars.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {/* Shared layoutId makes the pill slide between tabs instead of blinking. */}
      {active && (
        <MotionBox
          layoutId="fb-bilibili-tab-pill"
          transition={{ type: 'spring', stiffness: 320, damping: 28 }}
          sx={(theme) => ({
            position: 'absolute',
            inset: 0,
            borderRadius: 1.5,
            bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
          })}
        />
      )}
      <Iconify icon={icon} width={16} sx={{ position: 'relative' }} />
      <Box component="span" sx={{ position: 'relative' }}>
        {label}
      </Box>
    </ButtonBase>
  );
}

function TimeChip({ time }: { time: string }) {
  return (
    <Box
      sx={(theme) => ({
        px: 0.75,
        py: 0.25,
        flexShrink: 0,
        borderRadius: 0.75,
        fontSize: 11,
        fontWeight: 700,
        fontFamily: 'monospace',
        color: 'primary.main',
        bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.12),
      })}
    >
      {time}
    </Box>
  );
}

/** Mock of the content-script panel that favbase mounts in the video sidebar. */
function PanelMock() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = useState<PanelTab>('subtitle');
  const pickedRef = useRef(false);

  // Auto-advance once, to show both tabs exist — but never fight a real click.
  useEffect(() => {
    if (!inView || reduceMotion) return;
    const timer = setTimeout(() => {
      if (!pickedRef.current) setTab('summary');
    }, 2800);
    return () => clearTimeout(timer);
  }, [inView, reduceMotion]);

  const pick = (next: PanelTab) => {
    pickedRef.current = true;
    setTab(next);
  };

  return (
    <Box
      ref={ref}
      sx={(theme) => ({
        width: { xs: 1, md: 280 },
        flexShrink: 0,
        p: 1.5,
        borderRadius: '16px',
        bgcolor: 'background.paper',
        border: `1px solid ${theme.vars.palette.divider}`,
        boxShadow: theme.vars.customShadows.z8,
      })}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 0.5, pb: 1.25 }}>
        <Box
          component="img"
          src="/icon/48.png"
          alt=""
          sx={{ width: 18, height: 18, borderRadius: 0.5 }}
        />
        <Typography variant="caption" sx={{ fontWeight: 700 }}>
          favbase
        </Typography>
      </Box>

      <Box role="tablist" sx={{ display: 'flex', gap: 0.5 }}>
        <TabButton
          active={tab === 'subtitle'}
          label={t('sidebar.subtitles')}
          icon="solar:subtitles-bold-duotone"
          onClick={() => pick('subtitle')}
        />
        <TabButton
          active={tab === 'summary'}
          label={t('sidebar.summary')}
          icon="solar:magic-stick-3-bold-duotone"
          onClick={() => pick('summary')}
        />
      </Box>

      {/* Tall enough for the summary tab, the taller of the two. */}
      <Box sx={{ mt: 1.5, minHeight: 240 }}>
        <AnimatePresence mode="wait">
          <MotionBox
            key={tab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28 }}
          >
            {tab === 'subtitle' ? (
              <Stack spacing={1}>
                {SUBTITLE_LINES.map((line, i) => (
                  <MotionBox
                    key={line.time}
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.14, duration: 0.4 }}
                    sx={(theme) => ({
                      display: 'flex',
                      gap: 1,
                      p: 1,
                      borderRadius: 1.25,
                      bgcolor:
                        i === 1
                          ? varAlpha(theme.vars.palette.primary.mainChannel, 0.08)
                          : 'transparent',
                    })}
                  >
                    <TimeChip time={line.time} />
                    <Typography variant="caption" sx={{ lineHeight: 1.6 }}>
                      {t(line.textKey)}
                    </Typography>
                  </MotionBox>
                ))}
              </Stack>
            ) : (
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                  {t('welcome.bilibili.summaryHeading')}
                </Typography>
                <Stack spacing={1} sx={{ mt: 1 }}>
                  {CHAPTERS.map((chapter, i) => (
                    <MotionBox
                      key={chapter.time}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 + i * 0.14, duration: 0.4 }}
                      sx={(theme) => ({
                        p: 1,
                        borderRadius: 1.25,
                        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
                      })}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <TimeChip time={chapter.time} />
                        {chapter.ad && (
                          <Box
                            sx={(theme) => ({
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 0.25,
                              px: 0.75,
                              borderRadius: 0.75,
                              fontSize: 10,
                              fontWeight: 700,
                              color: 'warning.dark',
                              bgcolor: varAlpha(theme.vars.palette.warning.mainChannel, 0.2),
                            })}
                          >
                            <Iconify icon="solar:danger-triangle-bold-duotone" width={11} />
                            {t('welcome.bilibili.adBadge')}
                          </Box>
                        )}
                      </Box>
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                        {t(chapter.textKey)}
                      </Typography>
                    </MotionBox>
                  ))}
                </Stack>
              </Box>
            )}
          </MotionBox>
        </AnimatePresence>
      </Box>
    </Box>
  );
}

/** Skeleton of the bilibili player next to the panel — context, not a replica. */
function PlayerMock() {
  const { t } = useTranslation();

  return (
    <Box sx={{ flex: 1, minWidth: 0 }}>
      <Box
        sx={{
          position: 'relative',
          aspectRatio: '16 / 9',
          borderRadius: '16px',
          overflow: 'hidden',
          display: 'grid',
          placeItems: 'center',
          background: 'linear-gradient(135deg, #1c252e 0%, #28323d 100%)',
        }}
      >
        <MotionBox
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 3.6, repeat: Infinity, ease: 'easeInOut' }}
          sx={(theme) => ({
            width: 56,
            height: 56,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: 'common.white',
            bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.92),
          })}
        >
          <Iconify icon="solar:play-bold" width={22} />
        </MotionBox>

        <Box
          sx={{
            position: 'absolute',
            inset: 'auto 12px 12px 12px',
            height: 4,
            borderRadius: 999,
            bgcolor: 'rgba(255,255,255,0.24)',
            overflow: 'hidden',
          }}
        >
          {/* Full-width bar scaled down: the transform runs on the
              compositor, unlike animating `width` which relayouts per frame. */}
          <MotionBox
            initial={{ scaleX: 0.12 }}
            whileInView={{ scaleX: 0.46 }}
            viewport={{ once: true }}
            transition={{ duration: 2.4, ease: 'easeInOut' }}
            sx={{
              height: 1,
              width: 1,
              borderRadius: 999,
              transformOrigin: 'left',
              bgcolor: 'primary.main',
            }}
          />
        </Box>
      </Box>

      <Typography variant="subtitle2" sx={{ mt: 1.75 }}>
        {t('welcome.bilibili.mockTitle')}
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 1.25 }}>
        {[0.9, 0.55].map((width) => (
          <Box
            key={width}
            sx={(theme) => ({
              height: 8,
              width: `${width * 100}%`,
              borderRadius: 999,
              bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.16),
            })}
          />
        ))}
      </Stack>
    </Box>
  );
}

export function BilibiliShowcase() {
  const { t } = useTranslation();

  return (
    <WelcomeSection
      id="welcome-bilibili"
      sx={(theme) => ({
        scrollMarginTop: 80,
        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.04),
        borderTop: `1px solid ${theme.vars.palette.divider}`,
        borderBottom: `1px solid ${theme.vars.palette.divider}`,
      })}
    >
      <Grid container spacing={{ xs: 5, md: 6 }} sx={{ alignItems: 'center' }}>
        <Grid size={{ xs: 12, md: 7 }}>
          <FadeIn delay={0.06} duration={0.8} y={32}>
            <Box
              sx={(theme) => ({
                display: 'flex',
                flexDirection: { xs: 'column', md: 'row' },
                gap: 2,
                p: { xs: 2, md: 2.5 },
                borderRadius: '24px',
                bgcolor: 'background.paper',
                border: `1px solid ${theme.vars.palette.divider}`,
                boxShadow: theme.vars.customShadows.card,
              })}
            >
              <PlayerMock />
              <PanelMock />
            </Box>
          </FadeIn>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <FadeIn y={-12}>
            <Eyebrow icon="simple-icons:bilibili">{t('welcome.bilibili.eyebrow')}</Eyebrow>
          </FadeIn>

          <FadeIn delay={0.08} sx={{ mt: 2.5 }}>
            <Headline>{t('welcome.bilibili.heading')}</Headline>
          </FadeIn>

          <FadeIn delay={0.16}>
            <Typography
              sx={{ mt: 2.5, color: 'text.secondary', lineHeight: 1.75, textWrap: 'pretty' }}
            >
              {t('welcome.bilibili.desc')}
            </Typography>
          </FadeIn>

          <FeatureList items={FEATURES} />
        </Grid>
      </Grid>
    </WelcomeSection>
  );
}
