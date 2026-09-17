import type { LocaleKeys } from '@/lib/i18n';

import { useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';
import { AGENT_SETUP_GUIDE_URL } from '@/lib/repo';

import { FadeIn } from '../components/fade-in';
import { FeatureList } from '../components/feature-list';
import { Eyebrow, Headline, WelcomeSection } from '../components/section-shell';

const FEATURES: LocaleKeys[] = [
  'welcome.agentSkills.feature1',
  'welcome.agentSkills.feature2',
  'welcome.agentSkills.feature3',
];

/** How long the copy button stays on its result label before reverting. */
const FEEDBACK_MS = 2000;

type CopyStatus = 'idle' | 'copied' | 'failed';

/**
 * Agent Skills: the same local library, asked from the user's coding agent
 * instead of from Chat.
 *
 * The only genuinely useful thing on this screen is the one line a user can
 * paste into Claude Code, so that line IS the screen — no mock panel. The two
 * bands around this one already carry a scripted demo each; a third would read
 * as decoration and dilute the one element here that actually does something.
 *
 * Deliberately NOT shown: `npm install -g favbase` or any `favbase setup`
 * command. Pairing needs a Bridge Token that does not exist yet during
 * onboarding (the switch is still off), so a command printed here would be a
 * placeholder the user could only fail with. The Agent Setup Guide behind the
 * URL walks the agent through it and stops to ask for the real command from
 * the settings card; see docs/adr/0005.
 *
 * Copy feedback is local on purpose: welcome mounts no `<Snackbar/>`, and
 * `sonner` is fenced to `app/components/snackbar/**` by
 * `tests/ui-vendor-boundaries.test.ts`.
 */
export function AgentSkills() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CopyStatus>('idle');
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const prompt = t('welcome.agentSkills.prompt', { url: AGENT_SETUP_GUIDE_URL });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setStatus('copied');
    } catch {
      // Clipboard access can be denied or simply absent; the command stays on
      // screen as selectable text, so say so rather than claiming success.
      setStatus('failed');
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setStatus('idle'), FEEDBACK_MS);
  };

  const buttonLabel =
    status === 'copied'
      ? t('welcome.agentSkills.copied')
      : status === 'failed'
        ? t('welcome.agentSkills.copyFailed')
        : t('welcome.agentSkills.copy');

  return (
    <WelcomeSection>
      <Box
        sx={{
          maxWidth: 760,
          mx: 'auto',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <FadeIn>
          <Eyebrow icon="solar:code-bold-duotone">{t('welcome.agentSkills.eyebrow')}</Eyebrow>
        </FadeIn>

        <FadeIn delay={0.06} y={16} sx={{ mt: 2.5 }}>
          <Headline>{t('welcome.agentSkills.heading')}</Headline>
        </FadeIn>

        <FadeIn delay={0.12}>
          <Typography
            sx={{
              mt: 2,
              maxWidth: 560,
              color: 'text.secondary',
              lineHeight: 1.75,
              textWrap: 'pretty',
            }}
          >
            {t('welcome.agentSkills.desc')}
          </Typography>
        </FadeIn>

        <FadeIn delay={0.2} sx={{ width: 1, mt: 4 }}>
          <Box
            sx={(theme) => ({
              p: { xs: 2, sm: 2.5 },
              borderRadius: 2,
              textAlign: 'left',
              bgcolor: 'background.neutral',
              border: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
            })}
          >
            <Typography
              variant="caption"
              sx={{ display: 'block', mb: 1, color: 'text.secondary', fontWeight: 600 }}
            >
              {t('welcome.agentSkills.promptLabel')}
            </Typography>

            <Box
              sx={{
                display: 'flex',
                flexDirection: { xs: 'column', sm: 'row' },
                alignItems: { xs: 'stretch', sm: 'center' },
                gap: 1.5,
              }}
            >
              <Box
                component="code"
                sx={{
                  flexGrow: 1,
                  minWidth: 0,
                  // The URL is one long unbreakable token; let it wrap instead
                  // of pushing the card into a horizontal scroll on phones.
                  overflowWrap: 'anywhere',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  fontSize: 13,
                  lineHeight: 1.7,
                  color: 'text.primary',
                }}
              >
                {prompt}
              </Box>

              <Button
                variant="contained"
                color="inherit"
                onClick={handleCopy}
                startIcon={
                  <Iconify
                    icon={status === 'copied' ? 'eva:checkmark-fill' : 'lucide:copy'}
                    width={18}
                  />
                }
                sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'auto' } }}
              >
                {buttonLabel}
              </Button>
            </Box>
          </Box>

          {/* The button's own label swap is not announced reliably; this is.
              Written out rather than imported: this MUI build ships no
              `visuallyHidden` helper. */}
          <Box
            aria-live="polite"
            sx={{
              position: 'absolute',
              width: 1,
              height: 1,
              p: 0,
              m: -1,
              overflow: 'hidden',
              clip: 'rect(0 0 0 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {status === 'idle' ? '' : buttonLabel}
          </Box>
        </FadeIn>

        <Box sx={{ width: 1, maxWidth: 560, textAlign: 'left' }}>
          <FeatureList items={FEATURES} startDelay={0.28} />
        </Box>

        <FadeIn delay={0.6}>
          <Typography variant="caption" sx={{ display: 'block', mt: 3.5, color: 'text.disabled' }}>
            {t('welcome.agentSkills.requirement')}
          </Typography>
        </FadeIn>
      </Box>
    </WelcomeSection>
  );
}
