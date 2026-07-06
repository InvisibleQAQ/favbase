import type { LocaleKeys } from '@/lib/i18n';
import type { LocalePreference } from '@/lib/storage';

import { useState } from 'react';

import Box from '@mui/material/Box';
import Menu from '@mui/material/Menu';
import Tooltip from '@mui/material/Tooltip';
import MenuItem from '@mui/material/MenuItem';
import IconButton from '@mui/material/IconButton';
import ListItemText from '@mui/material/ListItemText';
import ListItemIcon from '@mui/material/ListItemIcon';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';

const REPO_URL = 'https://github.com/InvisibleQAQ/favbase';

const LANGUAGE_OPTIONS: { value: LocalePreference; labelKey: LocaleKeys }[] = [
  { value: 'auto', labelKey: 'settings.languageAuto' },
  { value: 'zh-CN', labelKey: 'settings.languageZhCN' },
  { value: 'en', labelKey: 'settings.languageEn' },
];

export function HeaderActions() {
  const { t, preference, setLocale } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleSelect = (value: LocalePreference) => {
    setLocale(value);
    setAnchorEl(null);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0, sm: 0.75 } }}>
      <Tooltip title={t('header.languageAria')}>
        <IconButton
          aria-label={t('header.languageAria')}
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          <Iconify icon="solar:global-bold-duotone" />
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
            selected={preference === opt.value}
            onClick={() => handleSelect(opt.value)}
          >
            <ListItemIcon sx={{ minWidth: 28 }}>
              {preference === opt.value && <Iconify icon="eva:checkmark-fill" width={18} />}
            </ListItemIcon>
            <ListItemText>{t(opt.labelKey)}</ListItemText>
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
