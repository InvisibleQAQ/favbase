import type { IconButtonProps } from '@mui/material/IconButton';

import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';

import { REPO_URL } from '@/lib/repo';
import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../../components/iconify';

/** Repository link, shared by the dashboard header and the welcome top bar. */
export function GithubButton({ sx, ...other }: IconButtonProps) {
  const { t } = useTranslation();

  return (
    <Tooltip title={t('header.githubAria')}>
      <IconButton
        component="a"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('header.githubAria')}
        sx={sx}
        {...other}
      >
        <Iconify icon="mdi:github" />
      </IconButton>
    </Tooltip>
  );
}
