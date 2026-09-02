import type { ButtonBaseProps } from '@mui/material/ButtonBase';

import { varAlpha } from 'minimal-shared/utils';

import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';

import { Iconify } from '../../iconify';

/**
 * Drawer building blocks (Minimal `components/settings/drawer/styles.tsx`).
 * `LargeBlock` is a fieldset-looking card whose floating label doubles as its
 * per-block reset; `OptionButton` is the tile used by the Mode and Presets
 * grids. `SmallBlock` is not ported — Favbase has no nested option groups.
 */

type LargeBlockProps = React.ComponentProps<typeof LargeBlockRoot> & {
  title: string;
  tooltip?: string;
  resetLabel?: string;
  canReset?: boolean;
  onReset?: () => void;
};

const LargeBlockRoot = styled('div')(({ theme }) => ({
  display: 'flex',
  position: 'relative',
  flexDirection: 'column',
  padding: theme.spacing(4, 2, 2, 2),
  borderRadius: Number(theme.shape.borderRadius) * 2,
  border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
}));

const LargeLabel = styled('span')(({ theme }) => ({
  top: -12,
  lineHeight: '22px',
  borderRadius: '22px',
  position: 'absolute',
  alignItems: 'center',
  display: 'inline-flex',
  padding: theme.spacing(0, 1.25),
  fontSize: theme.typography.pxToRem(13),
  color: theme.vars.palette.common.white,
  fontWeight: theme.typography.fontWeightSemiBold,
  backgroundColor: theme.vars.palette.text.primary,
  ...theme.applyStyles('dark', {
    color: theme.vars.palette.grey[800],
  }),
}));

export function LargeBlock({
  sx,
  title,
  tooltip,
  children,
  canReset,
  onReset,
  resetLabel,
  ...other
}: LargeBlockProps) {
  return (
    <LargeBlockRoot sx={sx} {...other}>
      <LargeLabel>
        {canReset && (
          <ButtonBase
            disableRipple
            aria-label={resetLabel}
            onClick={onReset}
            sx={{ ml: -0.5, mr: 0.5 }}
          >
            <Iconify width={14} icon="solar:restart-bold" sx={{ opacity: 0.64 }} />
          </ButtonBase>
        )}
        {title}
        {tooltip && (
          <Tooltip title={tooltip} placement="right" arrow>
            <Iconify
              width={14}
              icon="eva:info-outline"
              sx={{ ml: 0.5, mr: -0.5, opacity: 0.48, cursor: 'pointer' }}
            />
          </Tooltip>
        )}
      </LargeLabel>

      {children}
    </LargeBlockRoot>
  );
}

export type OptionButtonProps = ButtonBaseProps & {
  selected?: boolean;
};

export function OptionButton({ selected, sx, children, ...other }: OptionButtonProps) {
  return (
    <ButtonBase
      disableRipple
      aria-pressed={selected}
      sx={[
        (theme) => ({
          width: 1,
          gap: 0.75,
          borderRadius: 1.5,
          lineHeight: '18px',
          flexDirection: 'column',
          color: 'text.disabled',
          border: `solid 1px transparent`,
          fontWeight: 'fontWeightSemiBold',
          fontSize: theme.typography.pxToRem(13),
          ...(selected && {
            color: 'text.primary',
            bgcolor: 'background.paper',
            borderColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
            boxShadow: `-8px 8px 20px -4px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
            ...theme.applyStyles('dark', {
              boxShadow: `-8px 8px 20px -4px ${varAlpha(theme.vars.palette.common.blackChannel, 0.12)}`,
            }),
            '& svg': { color: 'primary.main' },
          }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {children}
    </ButtonBase>
  );
}
