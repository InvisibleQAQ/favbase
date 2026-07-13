import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { UsedTag } from '@/lib/tagging';
import { Iconify } from '../iconify';

interface TagFilterChipsProps {
  tags: UsedTag[];
  selectedIds: string[];
  onToggle: (tagId: string) => void;
  onClear: () => void;
}

/**
 * Tag filter chips (multi-select, AND semantics). Renders nothing when no tag
 * is linked to any item — orphan tags are invisible by construction.
 */
export function TagFilterChips({ tags, selectedIds, onToggle, onClear }: TagFilterChipsProps) {
  const { t } = useTranslation();

  if (tags.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Iconify icon="mdi:tag" width={18} sx={{ color: 'primary.main' }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {t('tags.sectionTitle')}
        </Typography>
        {selectedIds.length > 0 && (
          <Button size="small" variant="text" onClick={onClear} sx={{ minWidth: 0, px: 1, py: 0 }}>
            {t('tags.clearFilter')}
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {tags.map((tag) => {
          const isSelected = selectedIds.includes(tag.id);
          return (
            <Chip
              key={tag.id}
              label={`${tag.name} (${tag.count})`}
              clickable
              onClick={() => onToggle(tag.id)}
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              sx={{
                maxWidth: 200,
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}
