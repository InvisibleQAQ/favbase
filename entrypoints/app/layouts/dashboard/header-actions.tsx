import type { LocaleKeys, SupportedLocale } from '@/lib/i18n';

import { useState } from 'react';

import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';
import { useColorScheme } from '@mui/material/styles';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';

import type { IconifyName } from '../../components/iconify';

const REPO_URL = 'https://github.com/InvisibleQAQ/favbase';

// Flag-based switcher: one entry per concrete language (no `auto`). Selection is
// keyed off the *resolved* locale, so `preference='auto'` still highlights and
// shows the active language's flag. `auto` itself lives in Settings > General.
const FLAG_WIDTH = 24;
const FLAG_HEIGHT = 18; // 4:3 of flagpack's 32x24 viewBox — avoids squish

const LANGUAGE_OPTIONS: { value: SupportedLocale; labelKey: LocaleKeys; flag: IconifyName }[] = [
  { value: 'zh-CN', labelKey: 'settings.languageZhCN', flag: 'flagpack:cn' },
  { value: 'en', labelKey: 'settings.languageEn', flag: 'flagpack:gb' },
];

function ThemeToggleButton() {
  const { t } = useTranslation();
  const { mode, systemMode, setMode } = useColorScheme();

  // Before mount MUI returns mode=undefined; fall back to the attribute the
  // index.html FOUC guard already set, so the icon never flips post-mount.
  const resolved =
    (mode === 'system' ? systemMode : mode) ??
    (document.documentElement.getAttribute('data-color-scheme') === 'dark' ? 'dark' : 'light');

  return (
    <Tooltip title={t('header.themeAria')}>
      <IconButton
        aria-label={t('header.themeAria')}
        onClick={() => setMode(resolved === 'dark' ? 'light' : 'dark')}
      >
        <Iconify icon={resolved === 'dark' ? 'solar:sun-bold-duotone' : 'solar:moon-bold-duotone'} />
      </IconButton>
    </Tooltip>
  );
}

export function HeaderActions() {
  const { t, locale, setLocale } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const activeFlag =
    LANGUAGE_OPTIONS.find((opt) => opt.value === locale)?.flag ?? LANGUAGE_OPTIONS[0].flag;

  const handleSelect = (value: SupportedLocale) => {
    setLocale(value);
    setAnchorEl(null);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0, sm: 0.75 } }}>
      <ThemeToggleButton />

      <Tooltip title={t('header.languageAria')}>
        <IconButton
          aria-label={t('header.languageAria')}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          <Iconify icon={activeFlag} width={FLAG_WIDTH} height={FLAG_HEIGHT} sx={{ borderRadius: 0.5 }} />
        </IconButton>
      </Tooltip>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {LANGUAGE_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.value}
            selected={locale === opt.value}
            onClick={() => handleSelect(opt.value)}
          >
            <ListItemIcon sx={{ minWidth: 0, mr: 1.25 }}>
              <Iconify icon={opt.flag} width={FLAG_WIDTH} height={FLAG_HEIGHT} sx={{ borderRadius: 0.5 }} />
            </ListItemIcon>
            <ListItemText>{t(opt.labelKey)}</ListItemText>
            {locale === opt.value && (
              <Box
                sx={(theme) => ({
                  ml: 2,
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: theme.vars.palette.primary.main,
                })}
              />
            )}
          </MenuItem>
        ))}
      </Menu>

      <Tooltip title={t('header.githubAria')}>
        <IconButton
          component="a"
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('header.githubAria')}
        >
          <Iconify icon="mdi:github" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
