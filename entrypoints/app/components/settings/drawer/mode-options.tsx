import type { BoxProps } from '@mui/material/Box';
import type { ColorModeValue } from '../../../theme/mode-transition';

import Box from '@mui/material/Box';
import { useColorScheme } from '@mui/material/styles';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../iconify';
import { OptionButton } from './styles';
import { setModeWithReveal, revealOriginFrom } from '../../../theme/mode-transition';

import type { LocaleKeys } from '@/lib/i18n';
import type { IconifyName } from '../../iconify';

/**
 * Light / Dark / System.
 *
 * Minimal's drawer ships a two-state switch, which cannot say "follow the
 * system" — and `system` is `ThemeProvider`'s default, so it has to be
 * expressible. Mode is not part of `local:themeSettings`: MUI owns it under
 * `favbase-color-mode` (D13), which is why this block reads `useColorScheme()`
 * instead of the settings context.
 */
const MODE_OPTIONS: { value: ColorModeValue; labelKey: LocaleKeys; icon: IconifyName }[] = [
  { value: 'light', labelKey: 'settingsDrawer.modeLight', icon: 'solar:sun-bold-duotone' },
  { value: 'dark', labelKey: 'settingsDrawer.modeDark', icon: 'solar:moon-bold-duotone' },
  { value: 'system', labelKey: 'settingsDrawer.modeSystem', icon: 'solar:monitor-bold-duotone' },
];

export function ModeOptions({ sx, ...other }: BoxProps) {
  const { t } = useTranslation();
  const { mode, setMode } = useColorScheme();

  const current: ColorModeValue = mode ?? 'system';

  const handleSelect = (event: React.MouseEvent<HTMLElement>, next: ColorModeValue) => {
    if (next === current) return;
    setModeWithReveal(setMode, next, revealOriginFrom(event.currentTarget));
  };

  return (
    <Box
      sx={[
        { gap: 1.5, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {MODE_OPTIONS.map((option) => (
        <OptionButton
          key={option.value}
          selected={current === option.value}
          onClick={(event) => handleSelect(event, option.value)}
          sx={{ height: 64, fontSize: (theme) => theme.typography.pxToRem(11) }}
        >
          <Iconify icon={option.icon} width={24} />
          {t(option.labelKey)}
        </OptionButton>
      ))}
    </Box>
  );
}
