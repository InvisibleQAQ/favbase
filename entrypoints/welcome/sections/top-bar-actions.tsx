import Box from '@mui/material/Box';

import { GithubButton } from '@/entrypoints/app/layouts/components/github-button';
import { LanguagePopover } from '@/entrypoints/app/layouts/components/language-popover';
import { ThemeModeButton } from '@/entrypoints/app/layouts/components/theme-mode-button';

/**
 * Welcome top-bar controls: theme, language, repository.
 *
 * All three are shared leaves from `app/layouts/components/`, imported by file
 * rather than through the barrel — the barrel pulls `settings-button` → the
 * settings context → storage, which welcome.html deliberately does not mount.
 *
 * The theme control was a private switch here between docs/25 Step 4 (when
 * app.html moved its theme control into the appearance drawer) and 2026-09-05,
 * when light/dark came back to the app Header as `ThemeModeButton` and the two
 * pages went back to one component. `favbase-color-mode` and the View
 * Transition reveal are unchanged; only the shape is (switch → icon button).
 */
export function TopBarActions() {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 0, sm: 0.75 } }}>
      <ThemeModeButton />
      <LanguagePopover />
      <GithubButton />
    </Box>
  );
}
