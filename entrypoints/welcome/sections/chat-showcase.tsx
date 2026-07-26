import type { LocaleKeys } from '@/lib/i18n';
import type { IconifyName } from '@/entrypoints/app/components/iconify';

import { useEffect, useRef, useState } from 'react';
import { useInView, useReducedMotion } from 'motion/react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { FadeIn } from '../components/fade-in';
import { MotionBox } from '../components/motion-box';
import { FeatureList } from '../components/feature-list';
import { useTypewriter } from '../hooks/use-typewriter';
import { Eyebrow, Headline, WelcomeSection } from '../components/section-shell';

const FEATURES: LocaleKeys[] = [
  'welcome.chat.feature1',
  'welcome.chat.feature2',
  'welcome.chat.feature3',
];

const SOURCES: { labelKey: LocaleKeys; icon: IconifyName }[] = [
  { labelKey: 'welcome.chat.demoSource1', icon: 'simple-icons:bilibili' },
  { labelKey: 'welcome.chat.demoSource2', icon: 'mdi:github' },
  { labelKey: 'welcome.chat.demoSource3', icon: 'simple-icons:zhihu' },
];

/**
 * Scripted playback phases. The demo runs once when the panel scrolls into
 * view: question → tool call → tool result → streamed answer → sources.
 */
const PHASE = { idle: 0, question: 1, toolRunning: 2, toolDone: 3, answering: 4 } as const;
type Phase = (typeof PHASE)[keyof typeof PHASE];

function ToolCallRow({ done }: { done: boolean }) {
  const { t } = useTranslation();

  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        alignSelf: 'flex-start',
        px: 1.5,
        py: 0.75,
        borderRadius: 999,
        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.1),
        border: `1px solid ${theme.vars.palette.divider}`,
      })}
    >
      <Iconify icon="eva:search-fill" width={15} sx={{ color: 'text.secondary' }} />
      <Typography variant="caption" sx={{ fontWeight: 600, fontFamily: 'monospace' }}>
        {t('welcome.chat.demoTool')}
      </Typography>
      {done ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, color: 'success.main' }}>
          <Iconify icon="solar:check-circle-bold" width={15} />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {t('welcome.chat.demoToolResult')}
          </Typography>
        </Box>
      ) : (
        <CircularProgress size={12} thickness={6} sx={{ color: 'text.disabled' }} />
      )}
    </Box>
  );
}

function ChatDemo() {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.3 });
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>(PHASE.idle);

  useEffect(() => {
    if (!inView) return;

    // Reduced motion gets the finished conversation, not a slower one.
    if (reduceMotion) {
      setPhase(PHASE.answering);
      return;
    }

    const timers = [
      setTimeout(() => setPhase(PHASE.question), 250),
      setTimeout(() => setPhase(PHASE.toolRunning), 900),
      setTimeout(() => setPhase(PHASE.toolDone), 2050),
      setTimeout(() => setPhase(PHASE.answering), 2450),
    ];
    return () => timers.forEach(clearTimeout);
  }, [inView, reduceMotion]);

  const answer = useTypewriter(t('welcome.chat.demoAnswer'), phase >= PHASE.answering, 20);

  return (
    <Box
      ref={ref}
      sx={(theme) => ({
        borderRadius: '24px',
        overflow: 'hidden',
        bgcolor: 'background.paper',
        border: `1px solid ${theme.vars.palette.divider}`,
        boxShadow: theme.vars.customShadows.card,
      })}
    >
      <Box
        sx={(theme) => ({
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 2.5,
          py: 1.75,
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
          bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.04),
        })}
      >
        <Iconify
          icon="solar:chat-round-dots-bold"
          width={18}
          sx={{ color: 'primary.main' }}
        />
        <Typography variant="subtitle2">{t('chat.title')}</Typography>
      </Box>

      {/* Sized for the finished conversation so the reveal fills the panel
          instead of growing it and shoving the page around mid-animation. */}
      <Stack spacing={2} sx={{ p: { xs: 2, md: 3 }, minHeight: { xs: 420, md: 400 } }}>
        {phase >= PHASE.question && (
          <MotionBox
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            sx={(theme) => ({
              alignSelf: 'flex-end',
              maxWidth: '86%',
              px: 2,
              py: 1.25,
              borderRadius: '16px 16px 4px 16px',
              color: 'primary.darker',
              bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.16),
              ...theme.applyStyles('dark', { color: theme.vars.palette.primary.lighter }),
            })}
          >
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {t('welcome.chat.demoQuestion')}
            </Typography>
          </MotionBox>
        )}

        {phase >= PHASE.toolRunning && (
          <MotionBox
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
            sx={{ display: 'flex' }}
          >
            <ToolCallRow done={phase >= PHASE.toolDone} />
          </MotionBox>
        )}

        {phase >= PHASE.answering && (
          <Box>
            <Typography variant="body2" sx={{ lineHeight: 1.8, textWrap: 'pretty' }}>
              {answer.visible}
              {!answer.done && (
                <Box
                  component="span"
                  className="fb-caret"
                  sx={{
                    display: 'inline-block',
                    width: '2px',
                    height: '1em',
                    ml: '2px',
                    verticalAlign: 'text-bottom',
                    bgcolor: 'primary.main',
                  }}
                />
              )}
            </Typography>

            {answer.done && (
              <Box sx={{ mt: 2.5 }}>
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.disabled',
                    fontWeight: 600,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  {t('welcome.chat.demoSources')}
                </Typography>

                <Stack spacing={1} sx={{ mt: 1 }}>
                  {SOURCES.map((source, i) => (
                    <MotionBox
                      key={source.labelKey}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.12, duration: 0.4 }}
                      sx={(theme) => ({
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.25,
                        px: 1.5,
                        py: 1.25,
                        borderRadius: 2,
                        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
                        border: `1px solid ${theme.vars.palette.divider}`,
                      })}
                    >
                      <Iconify icon={source.icon} width={18} sx={{ flexShrink: 0 }} />
                      <Typography
                        variant="body2"
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontWeight: 500,
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {t(source.labelKey)}
                      </Typography>
                      <Iconify
                        icon="eva:arrow-ios-forward-fill"
                        width={16}
                        sx={{ color: 'text.disabled', flexShrink: 0 }}
                      />
                    </MotionBox>
                  ))}
                </Stack>
              </Box>
            )}
          </Box>
        )}
      </Stack>
    </Box>
  );
}

export function ChatShowcase() {
  const { t } = useTranslation();

  return (
    <WelcomeSection id="welcome-chat" sx={{ scrollMarginTop: 80 }}>
      <Grid container spacing={{ xs: 5, md: 6 }} alignItems="center">
        <Grid size={{ xs: 12, md: 5 }}>
          <FadeIn y={-12}>
            <Eyebrow icon="solar:magic-stick-3-bold-duotone">
              {t('welcome.chat.eyebrow')}
            </Eyebrow>
          </FadeIn>

          <FadeIn delay={0.08} sx={{ mt: 2.5 }}>
            <Headline>{t('welcome.chat.heading')}</Headline>
          </FadeIn>

          <FadeIn delay={0.16}>
            <Typography
              sx={{
                mt: 2.5,
                color: 'text.secondary',
                lineHeight: 1.75,
                textWrap: 'pretty',
              }}
            >
              {t('welcome.chat.desc')}
            </Typography>
          </FadeIn>

          <FeatureList items={FEATURES} />
        </Grid>

        <Grid size={{ xs: 12, md: 7 }}>
          <FadeIn delay={0.1} duration={0.8} y={36}>
            <ChatDemo />
          </FadeIn>
        </Grid>
      </Grid>
    </WelcomeSection>
  );
}
