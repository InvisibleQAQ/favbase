import type { Theme, SxProps } from '@mui/material/styles';

import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Badge from '@mui/material/Badge';
import Drawer from '@mui/material/Drawer';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { DEFAULT_THEME_SETTINGS } from '@/lib/storage';
import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../iconify';
import { LargeBlock } from './styles';
import { Scrollbar } from '../../scrollbar';
import { BaseOption } from './base-option';
import { ModeOptions } from './mode-options';
import { PresetsOptions } from './presets-options';
import { useSettingsContext } from '../context';
import { useSettingsReset } from '../use-settings-reset';
import { primaryColorPresets } from '../../../theme/with-settings';

import type { ThemeColorPreset } from '@/lib/storage';

/**
 * Appearance drawer (Minimal `components/settings/drawer/settings-drawer.tsx`).
 *
 * Favbase ships four of Minimal's options — Mode, Contrast, Compact, Presets —
 * and drops font family / font size / RTL / nav layout / nav color / fullscreen
 * (docs/25 §0.2), so there is no `defaultSettings`-driven visibility map: the
 * option set is fixed. Open/closed is in-memory context state, never persisted.
 */
export function SettingsDrawer({ sx }: { sx?: SxProps<Theme> }) {
  const { t } = useTranslation();
  const { state, setField, openDrawer, onCloseDrawer } = useSettingsContext();
  const { canReset, onResetAll } = useSettingsReset();

  const presetOptions = (Object.keys(primaryColorPresets) as ThemeColorPreset[]).map((name) => ({
    name,
    value: primaryColorPresets[name].main,
  }));

  const renderHead = () => (
    <Box sx={{ py: 2, pr: 1, pl: 2.5, display: 'flex', alignItems: 'center' }}>
      <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
        {t('settingsDrawer.title')}
      </Typography>

      <Tooltip title={t('settingsDrawer.reset')}>
        <IconButton aria-label={t('settingsDrawer.reset')} onClick={onResetAll}>
          <Badge color="error" variant="dot" invisible={!canReset}>
            <Iconify icon="solar:restart-bold" />
          </Badge>
        </IconButton>
      </Tooltip>

      <Tooltip title={t('settingsDrawer.close')}>
        <IconButton aria-label={t('settingsDrawer.close')} onClick={onCloseDrawer}>
          <Iconify icon="mingcute:close-line" />
        </IconButton>
      </Tooltip>
    </Box>
  );

  return (
    <Drawer
      anchor="right"
      open={openDrawer}
      onClose={onCloseDrawer}
      slotProps={{
        backdrop: { invisible: true },
        paper: {
          role: 'dialog',
          'aria-label': t('settingsDrawer.title'),
          sx: [
            (theme) => ({
              ...theme.mixins.paperStyles(theme, {
                color: varAlpha(theme.vars.palette.background.defaultChannel, 0.9),
              }),
              width: 360,
            }),
            ...(Array.isArray(sx) ? sx : [sx]),
          ],
        },
      }}
    >
      {renderHead()}

      <Scrollbar>
        <Box sx={{ pb: 5, gap: 6, px: 2.5, display: 'flex', flexDirection: 'column' }}>
          <LargeBlock title={t('settingsDrawer.mode')}>
            <ModeOptions />
          </LargeBlock>

          <Box sx={{ gap: 2, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <BaseOption
              icon="mdi:contrast-circle"
              label={t('settingsDrawer.contrast')}
              tooltip={t('settingsDrawer.contrastHint')}
              selected={state.contrast === 'high'}
              onChangeOption={() =>
                setField('contrast', state.contrast === 'default' ? 'high' : 'default')
              }
            />

            <BaseOption
              icon="mdi:arrow-collapse-horizontal"
              label={t('settingsDrawer.compact')}
              tooltip={t('settingsDrawer.compactHint')}
              selected={state.compactLayout}
              onChangeOption={() => setField('compactLayout', !state.compactLayout)}
            />
          </Box>

          <LargeBlock
            title={t('settingsDrawer.presets')}
            canReset={state.primaryColor !== DEFAULT_THEME_SETTINGS.primaryColor}
            resetLabel={t('settingsDrawer.reset')}
            onReset={() => setField('primaryColor', DEFAULT_THEME_SETTINGS.primaryColor)}
          >
            <PresetsOptions
              value={state.primaryColor}
              options={presetOptions}
              onChangeOption={(newOption) => setField('primaryColor', newOption)}
            />
          </LargeBlock>
        </Box>
      </Scrollbar>
    </Drawer>
  );
}
