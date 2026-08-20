import Box from '@mui/material/Box';
import Avatar from '@mui/material/Avatar';
import Typography from '@mui/material/Typography';

import { formatCompactNumber, formatDateTime } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollectionCard } from '../../components/collection';
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

  return (
    <CollectionCard
      href={repo.htmlUrl}
      header={
        <>
          <Avatar src={repo.ownerAvatarUrl ?? undefined} sx={{ width: 24, height: 24 }}>
            <Iconify icon="mdi:github" width={16} />
          </Avatar>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap>
            {repo.ownerLogin}
          </Typography>
        </>
      }
      title={repo.fullName}
      body={
        repo.description ? (
          <Typography
            variant="body2"
            title={repo.description}
            sx={{
              color: 'text.secondary',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              wordBreak: 'break-word',
            }}
          >
            {repo.description}
          </Typography>
        ) : undefined
      }
      meta={
        repo.language ? (
          <>
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
          </>
        ) : undefined
      }
      date={repo.starredAt ? formatDateTime(new Date(repo.starredAt).getTime()) : undefined}
      stats={
        <>
          <Iconify icon="mdi:star" width={14} sx={{ color: 'text.secondary' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {formatCompactNumber(repo.stargazersCount)}
          </Typography>
        </>
      }
      tags={tags ? <TagRow tags={tags} onEditTags={onEditTags} /> : undefined}
    />
  );
}
