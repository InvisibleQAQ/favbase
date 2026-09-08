import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';

export type BrandMarkProps = {
  /** Show the one-line product tagline under the wordmark. */
  tagline?: boolean;
};

/**
 * Icon plus wordmark, shared by the header's left slot and the footer. The
 * tagline is opt-in so the footer does not repeat what the header already said
 * a full page above.
 */
export function BrandMark({ tagline = false }: BrandMarkProps) {
  const { t } = useTranslation();

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
      <Box
        component="img"
        src="/icon/48.png"
        alt=""
        sx={{ width: 28, height: 28, borderRadius: 1 }}
      />

      <Box sx={{ minWidth: 0, textAlign: 'left' }}>
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

        {tagline && (
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', display: { xs: 'none', md: 'block' } }}
          >
            {t('welcome.brandTagline')}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
