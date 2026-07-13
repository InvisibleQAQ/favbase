import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatCompactNumber, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { TagRow } from '../../components/tags';
import type { GithubRepoItem } from '@/lib/github/github-sync-service';
import type { TagRef } from '@/lib/tagging';
import { languageColor } from './language-colors';

export interface RepoCardProps {
  repo: GithubRepoItem;
  /** undefined = tag UI hidden entirely (backward compatible); [] = no tags yet, edit button only. */
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

export function RepoCard({ repo, tags, onEditTags }: RepoCardProps) {
  // Subscribe to locale changes so formatCompactNumber/formatDateTime re-render.
  useTranslation();

  const handleClick = () => {
    window.open(repo.htmlUrl, '_blank');
  };

  return (
    <Card
      sx={(theme) => ({
        height: 1,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: theme.vars.customShadows.card,
        transition: 'box-shadow 0.2s',
        '&:hover': { boxShadow: theme.vars.customShadows.z8 },
      })}
    >
      <CardActionArea
        onClick={handleClick}
        sx={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1, flex: '1 1 auto' }}>
          {/* Owner avatar + full name */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            <Avatar src={repo.ownerAvatarUrl ?? undefined} sx={{ width: 32, height: 32 }}>
              <Iconify icon="mdi:github" width={20} />
            </Avatar>
            <Typography
              variant="subtitle2"
              title={repo.fullName}
              sx={{
                fontWeight: 600,
                minWidth: 0,
                wordBreak: 'break-all',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {repo.fullName}
            </Typography>
          </Box>

          {/* Description — 2-line clamp */}
          {repo.description && (
            <Typography
              variant="body2"
              title={repo.description}
              sx={{
                color: 'text.secondary',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {repo.description}
            </Typography>
          )}

          {/* Footer: language dot + star count + starred time */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 'auto', pt: 0.5 }}>
            {repo.language && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                <Box
                  sx={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    bgcolor: languageColor(repo.language),
                    flexShrink: 0,
                  }}
                />
                <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
                  {repo.language}
                </Typography>
              </Box>
            )}

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
              <Iconify icon="mdi:star" width={14} sx={{ color: 'warning.main' }} />
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {formatCompactNumber(repo.stargazersCount)}
              </Typography>
            </Box>

            {repo.starredAt && (
              <Typography variant="caption" sx={{ color: 'text.disabled', ml: 'auto' }} noWrap>
                {formatDateTime(new Date(repo.starredAt).getTime())}
              </Typography>
            )}
          </Box>
        </Box>
      </CardActionArea>

      {/* Tag row — outside CardActionArea so chips/edit don't trigger navigation */}
      {tags && <TagRow tags={tags} onEditTags={onEditTags} />}
    </Card>
  );
}
