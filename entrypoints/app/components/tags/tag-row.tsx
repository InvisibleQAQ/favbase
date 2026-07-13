import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { TagRef } from '@/lib/tagging';
import { Iconify } from '../iconify';

export interface TagRowProps {
  tags: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

/**
 * Compact tag chip row for cards: small outlined chips + trailing edit entry.
 * Render it OUTSIDE any CardActionArea so chips / the edit button don't
 * trigger the card's navigation click.
 */
export function TagRow({ tags, onEditTags }: TagRowProps) {
  const { t } = useTranslation();

  // No tags and no edit entry — nothing to show, no empty placeholder row.
  if (tags.length === 0 && !onEditTags) return null;

  return (
    <Box
      sx={{
        px: 1.5,
        pb: 1,
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.5,
      }}
    >
      {tags.map((tag) => (
        <Chip
          key={tag.id}
          label={tag.name}
          size="small"
          variant="outlined"
          sx={{ height: 20, fontSize: '0.6875rem' }}
        />
      ))}
      {onEditTags && (
        <Tooltip title={t('tags.editTooltip')}>
          <IconButton size="small" onClick={(e) => onEditTags(e.currentTarget)} sx={{ p: 0.25 }}>
            <Iconify icon="mdi:tag" width={14} sx={{ color: 'text.disabled' }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
