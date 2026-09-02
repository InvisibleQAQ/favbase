import type { IconButtonProps } from '@mui/material/IconButton';
import type { LocaleKeys, SupportedLocale } from '@/lib/i18n';

import { usePopover } from 'minimal-shared/hooks';

import MenuList from '@mui/material/MenuList';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';
import { CustomPopover } from '../../components/custom-popover';

import type { IconifyName } from '../../components/iconify';

/**
 * Language switcher (Minimal `layouts/components/language-popover.tsx` over
 * Favbase's own locale store, replacing the MUI `Menu` the deleted
 * `header-actions.tsx` used).
 *
 * One entry per concrete language, no `auto` — selection is keyed off the
 * *resolved* locale so `preference='auto'` still highlights and still shows the
 * right flag; `auto` itself stays in Settings → General.
 *
 * Flags are multi-color offline SVGs (`components/iconify/icon-sets.ts`):
 * Windows Chrome refuses to render emoji flags, so they cannot be text.
 */
const FLAG_WIDTH = 24;
const FLAG_HEIGHT = 18; // 4:3 of flagpack's 32x24 viewBox — avoids squish

const LANGUAGE_OPTIONS: { value: SupportedLocale; labelKey: LocaleKeys; flag: IconifyName }[] = [
  { value: 'zh-CN', labelKey: 'settings.languageZhCN', flag: 'flagpack:cn' },
  { value: 'en', labelKey: 'settings.languageEn', flag: 'flagpack:gb' },
];

export function LanguagePopover({ sx, ...other }: IconButtonProps) {
  const { t, locale, setLocale } = useTranslation();
  const { open, anchorEl, onOpen, onClose } = usePopover();

  const activeFlag =
    LANGUAGE_OPTIONS.find((option) => option.value === locale)?.flag ?? LANGUAGE_OPTIONS[0].flag;

  const handleSelect = (value: SupportedLocale) => {
    setLocale(value);
    onClose();
  };

  return (
    <>
      <Tooltip title={t('header.languageAria')}>
        <IconButton
          aria-label={t('header.languageAria')}
          onClick={onOpen}
          sx={[
            (theme) => ({ ...(open && { bgcolor: theme.vars.palette.action.selected }) }),
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
          {...other}
        >
          <Iconify
            icon={activeFlag}
            width={FLAG_WIDTH}
            height={FLAG_HEIGHT}
            sx={{ borderRadius: 0.5 }}
          />
        </IconButton>
      </Tooltip>

      <CustomPopover open={open} anchorEl={anchorEl} onClose={onClose}>
        <MenuList sx={{ minWidth: 160 }}>
          {LANGUAGE_OPTIONS.map((option) => (
            <MenuItem
              key={option.value}
              selected={option.value === locale}
              onClick={() => handleSelect(option.value)}
            >
              <Iconify
                icon={option.flag}
                width={FLAG_WIDTH}
                height={FLAG_HEIGHT}
                sx={{ borderRadius: 0.5 }}
              />
              {t(option.labelKey)}
            </MenuItem>
          ))}
        </MenuList>
      </CustomPopover>
    </>
  );
}
