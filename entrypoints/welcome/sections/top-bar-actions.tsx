import Box from '@mui/material/Box';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import { styled, useColorScheme } from '@mui/material/styles';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '@/entrypoints/app/components/iconify';
import { GithubButton } from '@/entrypoints/app/layouts/components/github-button';
import { LanguagePopover } from '@/entrypoints/app/layouts/components/language-popover';
import { setModeWithReveal, revealOriginFrom } from '@/entrypoints/app/theme/mode-transition';

/**
 * Welcome top-bar controls.
 *
 * Until docs/25 Step 4 this page reused the dashboard's `HeaderActions`
 * verbatim. app.html moved its theme control into the appearance drawer, which
 * needs a `SettingsProvider` welcome.html deliberately does not mount, so the
 * light/dark pill lives here now — same control, same View Transition reveal,
 * same `favbase-color-mode` key. Language and repo buttons are still the shared
 * ones from `app/layouts/components/` (imported as leaves, not through the
 * barrel, so the settings/storage layer stays out of the welcome bundle).
 */
const ThemeSwitch = styled(Switch)(({ theme }) => ({
  width: 40,
  height: 22,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    padding: 0,
    margin: 2,
    transitionDuration: '250ms',
    '&.Mui-checked': {
      transform: 'translateX(18px)',
      color: theme.vars.palette.common.white,
      '& + .MuiSwitch-track': {
        backgroundColor: theme.vars.palette.grey[700],
        opacity: 1,
        border: 0,
      },
    },
  },
  '& .MuiSwitch-thumb': {
    boxSizing: 'border-box',
    width: 18,
    height: 18,
    boxShadow: 'none',
  },
  '& .MuiSwitch-track': {
    borderRadius: '50%',
    backgroundColor: theme.vars.palette.grey[400],
    opacity: 1,
  },
}));

function ThemeToggleSwitch() {
  const { t } = useTranslation();
  const { mode, systemMode, setMode } = useColorScheme();

  // Before mount MUI returns mode=undefined; fall back to the attribute the
  // index.html FOUC guard already set, so the switch never flips post-mount.
  const resolved =
    (mode === 'system' ? systemMode : mode) ??
    (document.documentElement.getAttribute('data-color-scheme') === 'dark' ? 'dark' : 'light');

  const handleToggle = (event: React.ChangeEvent<HTMLInputElement>) => {
    setModeWithReveal(
      setMode,
      resolved === 'dark' ? 'light' : 'dark',
      revealOriginFrom(event.currentTarget),
    );
  };

  return (
    <Tooltip title={t('header.themeAria')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Iconify icon="custom:sun-color" width={18} />
        <ThemeSwitch
          checked={resolved === 'dark'}
          onChange={handleToggle}
          slotProps={{ input: { 'aria-label': t('header.themeAria') } }}
        />
        <Iconify icon="custom:moon-color" width={18} />
      </Box>
    </Tooltip>
  );
}

export function TopBarActions() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0, sm: 0.75 } }}>
      <ThemeToggleSwitch />
      <LanguagePopover />
      <GithubButton />
    </Box>
  );
}
