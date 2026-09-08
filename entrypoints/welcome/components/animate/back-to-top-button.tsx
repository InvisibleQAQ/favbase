import type { FabProps } from '@mui/material/Fab';

import { useBackToTop } from 'minimal-shared/hooks';

import Fab from '@mui/material/Fab';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

export type BackToTopButtonProps = FabProps & {
  isDebounce?: boolean;
  scrollThreshold?: string | number;
};

/**
 * Ported from Minimal `components/animate/back-to-top-button`, with two
 * changes. Its `renderButton` escape hatch is dropped (no consumer), and the
 * glyph is `eva:arrow-ios-upward-fill` rather than Minimal's
 * `solar:double-alt-arrow-up-bold-duotone` — only names registered in
 * `iconify/icon-sets.ts` are bundled, and an unregistered one would try the
 * network and render nothing under the MV3 CSP.
 *
 * The label goes through i18n like every other string on this page.
 */
export function BackToTopButton({
  sx,
  isDebounce,
  scrollThreshold = '90%',
  ...other
}: BackToTopButtonProps) {
  const { t } = useTranslation();
  const { onBackToTop, isVisible } = useBackToTop(scrollThreshold, isDebounce);

  return (
    <Fab
      aria-label={t('welcome.backToTop')}
      onClick={onBackToTop}
      sx={[
        (theme) => ({
          width: 48,
          height: 48,
          position: 'fixed',
          transform: 'scale(0)',
          right: { xs: 24, md: 32 },
          bottom: { xs: 24, md: 32 },
          zIndex: theme.zIndex.speedDial,
          transition: theme.transitions.create(['transform']),
          ...(isVisible && { transform: 'scale(1)' }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <Iconify width={24} icon="eva:arrow-ios-upward-fill" />
    </Fab>
  );
}
