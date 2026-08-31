import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { cardClasses } from '@mui/material/Card';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { TagRef } from '@/lib/tagging';
import { Iconify } from '../iconify';
import { CollectionCardRow } from '../collection';

export interface TagRowProps {
  tags: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

/**
 * Compact tag chip row for cards: small outlined chips + trailing edit entry,
 * laid out by the card's own `CollectionCardRow` so its inset is the card's.
 * Render it OUTSIDE any CardActionArea so chips / the edit button don't
 * trigger the card's navigation click.
 *
 * An untagged card draws no row at all: the edit entry floats in the card's
 * top-right corner and appears only on card hover / keyboard focus, so the
 * manual-tagging path survives without a grey placeholder on every entry.
 */
export function TagRow({ tags, onEditTags }: TagRowProps) {
  const { t } = useTranslation();

  // No tags and no edit entry — nothing to show, no empty placeholder row.
  if (tags.length === 0 && !onEditTags) return null;

  const editButton = onEditTags ? (
    <Tooltip title={t('tags.editTooltip')}>
      <IconButton
        size="small"
        aria-label={t('tags.editTooltip')}
        onClick={(e) => onEditTags(e.currentTarget)}
        sx={{ p: 0.5 }}
      >
        <Iconify icon="mdi:tag" width={16} sx={{ color: 'text.secondary' }} />
      </IconButton>
    </Tooltip>
  ) : null;

  if (tags.length === 0) {
    return (
      <Box
        data-slot="tag-edit-float"
        sx={(theme) => ({
          position: 'absolute',
          top: theme.spacing(1),
          right: theme.spacing(1),
          zIndex: 1,
          opacity: 0,
          borderRadius: 0.75,
          // Paper, not neutral: the hovered card is already the neutral wash.
          bgcolor: theme.vars.palette.background.paper,
          boxShadow: theme.vars.customShadows.z1,
          transition: theme.transitions.create('opacity', {
            duration: theme.transitions.duration.shortest,
          }),
          [`.${cardClasses.root}:hover &, .${cardClasses.root}:focus-within &`]: { opacity: 1 },
        })}
      >
        {editButton}
      </Box>
    );
  }

  return (
    <CollectionCardRow sx={{ gap: 0.5 }}>
      {tags.map((tag) => (
        <Chip key={tag.id} label={tag.name} size="small" variant="outlined" />
      ))}
      {editButton}
    </CollectionCardRow>
  );
}
