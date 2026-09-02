import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
// Theme pill + language popover + repo link (docs/25 Step 4 moved the pill here).
import { TopBarActions } from './top-bar-actions';

export const TOP_BAR_HEIGHT = 64;

export function TopBar() {
  const { t } = useTranslation();

  return (
    <Box
      component="header"
      sx={(theme) => ({
        position: 'fixed',
        inset: '0 0 auto 0',
        zIndex: 20,
        height: TOP_BAR_HEIGHT,
        backdropFilter: 'blur(12px)',
        bgcolor: varAlpha(theme.vars.palette.background.defaultChannel, 0.72),
        borderBottom: `1px solid ${theme.vars.palette.divider}`,
      })}
    >
      <Container
        maxWidth="lg"
        sx={{ height: 1, display: 'flex', alignItems: 'center', gap: 1.5 }}
      >
        <Box
          component="img"
          src="/icon/48.png"
          alt=""
          sx={{ width: 28, height: 28, borderRadius: 1 }}
        />

        <Box sx={{ minWidth: 0 }}>
          <Typography
            sx={(theme) => ({
              fontFamily: theme.typography.fontSecondaryFamily,
              fontWeight: 800,
              fontSize: 18,
              lineHeight: 1.15,
              letterSpacing: '-0.02em',
            })}
          >
            favbase
          </Typography>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: { xs: 'none', md: 'block' } }}
          >
            {t('welcome.brandTagline')}
          </Typography>
        </Box>

        <Box sx={{ flex: 1 }} />

        <TopBarActions />
      </Container>
    </Box>
  );
}
