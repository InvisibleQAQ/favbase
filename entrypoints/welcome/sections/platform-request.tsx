import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';
import { PLATFORM_REQUEST_ISSUE_URL } from '@/lib/repo';

import { FadeIn } from '../components/fade-in';
import { Headline, WelcomeSection } from '../components/section-shell';

/**
 * Platform Request (CONTEXT.md): closing outbound nudge — six platforms are a
 * starting point; ask for the next one on the issue tracker. Deliberately
 * modest (outlined button, no glow) so it never competes with the picker's
 * "enter favbase" CTA right above.
 */
export function PlatformRequest() {
  const { t } = useTranslation();

  return (
    <WelcomeSection sx={{ pt: 0, pb: { xs: 10, md: 14 } }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
        }}
      >
        <FadeIn y={16}>
          <Headline>{t('welcome.request.heading')}</Headline>
        </FadeIn>
        <FadeIn delay={0.08}>
          <Typography
            sx={{
              mt: 2,
              maxWidth: 520,
              color: 'text.secondary',
              lineHeight: 1.75,
              textWrap: 'pretty',
            }}
          >
            {t('welcome.request.desc')}
          </Typography>
        </FadeIn>
        <FadeIn delay={0.16} sx={{ mt: 4 }}>
          <Button
            size="large"
            variant="outlined"
            color="inherit"
            component="a"
            href={PLATFORM_REQUEST_ISSUE_URL}
            target="_blank"
            rel="noopener noreferrer"
            endIcon={<Iconify icon="eva:diagonal-arrow-right-up-fill" width={18} />}
            sx={{ px: 3.5, py: 1.25 }}
          >
            {t('welcome.request.cta')}
          </Button>
        </FadeIn>
      </Box>
    </WelcomeSection>
  );
}
