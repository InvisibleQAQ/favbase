import type { BoxProps } from '@mui/material/Box';
import type { LocaleKeys } from '@/lib/i18n';
import type { ThemeColorPreset } from '@/lib/storage';

import Box from '@mui/material/Box';
import { alpha as hexAlpha } from '@mui/material/styles';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../iconify';
import { OptionButton } from './styles';

/**
 * Primary-color presets (Minimal `drawer/presets-options.tsx`). The swatch is
 * Minimal's sidebar duotone glyph tinted with the preset — it shows the color
 * doing the job it will actually do (nav accents), which a bare dot does not.
 * Coral (`default`) comes first; the order is `primaryColorPresets`' own.
 */
const PRESET_LABEL_KEYS: Record<ThemeColorPreset, LocaleKeys> = {
  default: 'settingsDrawer.presetDefault',
  preset1: 'settingsDrawer.preset1',
  preset2: 'settingsDrawer.preset2',
  preset3: 'settingsDrawer.preset3',
  preset4: 'settingsDrawer.preset4',
  preset5: 'settingsDrawer.preset5',
};

export type PresetsOptionsProps = BoxProps & {
  value: ThemeColorPreset;
  options: { name: ThemeColorPreset; value: string }[];
  onChangeOption: (newOption: ThemeColorPreset) => void;
};

export function PresetsOptions({
  sx,
  value,
  options,
  onChangeOption,
  ...other
}: PresetsOptionsProps) {
  const { t } = useTranslation();

  return (
    <Box
      sx={[
        { gap: 1.5, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {options.map((option) => {
        const selected = value === option.name;

        return (
          <OptionButton
            key={option.name}
            selected={selected}
            aria-label={t(PRESET_LABEL_KEYS[option.name])}
            onClick={() => onChangeOption(option.name)}
            sx={{
              height: 64,
              // The glyph keeps the preset color even when selected, so it has
              // to win over OptionButton's `& svg` primary rule.
              '& svg': { color: option.value },
              ...(selected && { bgcolor: hexAlpha(option.value, 0.08) }),
            }}
          >
            <Iconify icon="solar:siderbar-bold-duotone" width={28} />
          </OptionButton>
        );
      })}
    </Box>
  );
}
