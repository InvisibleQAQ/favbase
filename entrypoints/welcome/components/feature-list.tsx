import type { LocaleKeys } from '@/lib/i18n';

import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { FadeIn } from './fade-in';

/**
 * Checkmarked bullets under a section headline, sliding in from the left one
 * after another. Shared by every showcase section so their rhythm matches.
 */
export function FeatureList({
  items,
  startDelay = 0.24,
}: {
  items: LocaleKeys[];
  /** Seconds before the first bullet moves; each next one trails by 0.1s. */
  startDelay?: number;
}) {
  const { t } = useTranslation();

  return (
    <Stack spacing={1.5} sx={{ mt: 3.5 }}>
      {items.map((key, i) => (
        <FadeIn
          key={key}
          delay={startDelay + i * 0.1}
          x={-16}
          y={0}
          sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.25 }}
        >
          <Iconify
            icon="eva:checkmark-fill"
            width={18}
            sx={{ mt: '3px', color: 'primary.main', flexShrink: 0 }}
          />
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {t(key)}
          </Typography>
        </FadeIn>
      ))}
    </Stack>
  );
}
