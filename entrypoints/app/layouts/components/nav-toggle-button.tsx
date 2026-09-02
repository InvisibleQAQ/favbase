import type { IconButtonProps } from '@mui/material/IconButton';

import { varAlpha } from 'minimal-shared/utils';

import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';

export type NavToggleButtonProps = IconButtonProps & {
  isNavMini: boolean;
};

/**
 * Rail collapse/expand control (Minimal `layouts/components/nav-toggle-button.tsx`).
 *
 * It rides the rail's right edge instead of sitting in the header. Fixed to the
 * viewport rather than parented to the rail on purpose: the rail keeps
 * `overflow: hidden` (so a 88 → 300 expansion never flashes its rows over the
 * content), which would clip a child sitting on the border. It tracks the same
 * `--layout-nav-vertical-width` variable with the same easing, so button and
 * rail edge move together. Vertically it lines up with the header's center.
 */
export function NavToggleButton({ isNavMini, sx, ...other }: NavToggleButtonProps) {
  const { t } = useTranslation();
  const label = isNavMini ? t('nav.expandAria') : t('nav.collapseAria');

  return (
    <Tooltip title={label} placement="right">
      <IconButton
        size="small"
        aria-label={label}
        aria-expanded={!isNavMini}
        sx={[
          (theme) => ({
            p: 0.5,
            position: 'fixed',
            color: 'action.active',
            bgcolor: 'background.default',
            transform: 'translate(-50%, -50%)',
            zIndex: 'var(--layout-nav-zIndex)',
            top: 'calc(var(--layout-header-desktop-height) / 2)',
            left: 'var(--layout-nav-vertical-width)',
            border: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
            transition: theme.transitions.create(['left'], {
              easing: 'var(--layout-transition-easing)',
              duration: 'var(--layout-transition-duration)',
            }),
            '&:hover': {
              color: 'text.primary',
              bgcolor: 'background.neutral',
            },
          }),
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
        {...other}
      >
        <Iconify
          width={16}
          icon={isNavMini ? 'eva:arrow-ios-forward-fill' : 'eva:arrow-ios-back-fill'}
        />
      </IconButton>
    </Tooltip>
  );
}
