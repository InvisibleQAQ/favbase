import type { IconButtonProps } from '@mui/material/IconButton';

import Badge from '@mui/material/Badge';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';
import { useSettingsContext, useSettingsReset } from '../../components/settings';

/**
 * Opens the appearance drawer (Minimal `layouts/components/settings-button.tsx`
 * minus its framer-motion spin — app.html carries no animation library).
 * The dot means "something here is not on its default".
 */
export function SettingsButton({ sx, ...other }: IconButtonProps) {
  const { t } = useTranslation();
  const { onToggleDrawer } = useSettingsContext();
  const { canReset } = useSettingsReset();

  return (
    <Tooltip title={t('header.settingsAria')}>
      <IconButton
        aria-label={t('header.settingsAria')}
        onClick={onToggleDrawer}
        sx={sx}
        {...other}
      >
        <Badge color="error" variant="dot" invisible={!canReset}>
          <Iconify icon="solar:settings-bold-duotone" />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
