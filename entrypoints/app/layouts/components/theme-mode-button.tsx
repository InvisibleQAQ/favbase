import type { IconButtonProps } from '@mui/material/IconButton';

import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import { useColorScheme } from '@mui/material/styles';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';
import { setModeWithReveal, revealOriginFrom } from '../../theme/mode-transition';

/**
 * light <-> dark in one click — shared by the dashboard Header and the welcome
 * top bar (2026-09-05; it used to be a private switch in
 * `welcome/sections/top-bar-actions.tsx`).
 *
 * Leaf on purpose, like `github-button` / `language-popover`: nothing from
 * `components/settings`, so welcome can import it by file without dragging the
 * provider layer into its bundle (`lib/i18n` reaches `localeStorage` the same
 * way the other two leaves do — that is not what this rule keeps out).
 *
 * Mode belongs to MUI (`favbase-color-mode`), not `local:themeSettings`
 * (docs/25 D13), hence `useColorScheme()`. `system` is not reachable from
 * here — the appearance drawer's three-way Mode block owns it.
 *
 * The glyph shows the *target* mode and the label says what the click does.
 * That is also what the two multi-color icons were drawn for (`icon-sets.ts`
 * `custom:sun-color` / `custom:moon-color`): the indigo moon reads on a light
 * header, the gold sun on a dark one.
 */
export function ThemeModeButton({ sx, ...other }: IconButtonProps) {
  const { t } = useTranslation();
  const { mode, systemMode, setMode } = useColorScheme();

  // Before mount MUI returns mode=undefined; fall back to the attribute the
  // FOUC guard already set, so the icon never flips post-mount.
  const resolved =
    (mode === 'system' ? systemMode : mode) ??
    (document.documentElement.getAttribute('data-color-scheme') === 'dark' ? 'dark' : 'light');

  const isDark = resolved === 'dark';
  const label = t(isDark ? 'header.themeToLight' : 'header.themeToDark');

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setModeWithReveal(setMode, isDark ? 'light' : 'dark', revealOriginFrom(event.currentTarget));
  };

  return (
    <Tooltip title={label}>
      <IconButton aria-label={label} onClick={handleClick} sx={sx} {...other}>
        <Iconify icon={isDark ? 'custom:sun-color' : 'custom:moon-color'} />
      </IconButton>
    </Tooltip>
  );
}
