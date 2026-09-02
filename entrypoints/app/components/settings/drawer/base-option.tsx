import type { ButtonBaseProps } from '@mui/material/ButtonBase';

import { varAlpha } from 'minimal-shared/utils';

import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import { styled } from '@mui/material/styles';
import ButtonBase from '@mui/material/ButtonBase';

import { Iconify } from '../../iconify';

import type { IconifyName } from '../../iconify';

/**
 * On/off option card (Minimal `drawer/base-option.tsx`). The whole card is the
 * control; the switch inside is decorative (`aria-hidden`, no own focus stop),
 * so there is exactly one tab stop and one accessible name per option.
 */
export type BaseOptionProps = Omit<ButtonBaseProps, 'action'> & {
  label: string;
  tooltip?: string;
  selected: boolean;
  icon: IconifyName;
  onChangeOption: () => void;
};

export function BaseOption({
  sx,
  icon,
  label,
  tooltip,
  selected,
  onChangeOption,
  ...other
}: BaseOptionProps) {
  return (
    <ItemRoot
      disableRipple
      role="switch"
      aria-checked={selected}
      aria-label={label}
      selected={selected}
      onClick={onChangeOption}
      sx={sx}
      {...other}
    >
      <TopContainer>
        <Iconify icon={icon} width={24} />
        <Switch
          size="small"
          color="default"
          checked={selected}
          tabIndex={-1}
          aria-hidden
          sx={{ mr: -0.75, pointerEvents: 'none' }}
        />
      </TopContainer>

      <BottomContainer>
        <ItemLabel>{label}</ItemLabel>

        {tooltip && (
          <Tooltip
            arrow
            title={tooltip}
            slotProps={{ tooltip: { sx: { maxWidth: 240, mr: 0.5 } } }}
          >
            <Iconify
              width={16}
              icon="eva:info-outline"
              sx={{ cursor: 'pointer', color: 'text.disabled' }}
            />
          </Tooltip>
        )}
      </BottomContainer>
    </ItemRoot>
  );
}

const ItemRoot = styled(ButtonBase, {
  shouldForwardProp: (prop: string) => !['selected', 'sx'].includes(prop),
})<{ selected: boolean }>(({ selected, theme }) => ({
  cursor: 'pointer',
  flexDirection: 'column',
  alignItems: 'flex-start',
  padding: theme.spacing(2, 2, 2, 2.5),
  borderRadius: Number(theme.shape.borderRadius) * 2,
  border: `solid 1px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.12)}`,
  '&:hover': {
    backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
  },
  ...(selected && {
    backgroundColor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
  }),
}));

const TopContainer = styled('div')(({ theme }) => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  marginBottom: theme.spacing(3),
  justifyContent: 'space-between',
}));

const BottomContainer = styled('div')(() => ({
  width: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
}));

const ItemLabel = styled('span')(({ theme }) => ({
  lineHeight: '18px',
  fontSize: theme.typography.pxToRem(13),
  fontWeight: theme.typography.fontWeightSemiBold,
}));
