import Button from '@mui/material/Button';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { UsedTag } from '@/lib/tagging';
import { Iconify } from '../iconify';
import { ChipRowShell, FilterChip } from '../collection';

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
    <ChipRowShell
      icon={<Iconify icon="mdi:tag" width={18} sx={{ color: 'primary.main' }} />}
      title={t('tags.sectionTitle')}
      headerExtra={
        selectedIds.length > 0 && (
          <Button size="small" variant="text" onClick={onClear} sx={{ minWidth: 0, px: 1, py: 0 }}>
            {t('tags.clearFilter')}
          </Button>
        )
      }
    >
      {tags.map((tag) => (
        <FilterChip
          key={tag.id}
          label={`${tag.name} (${tag.count})`}
          selected={selectedIds.includes(tag.id)}
          onClick={() => onToggle(tag.id)}
          maxWidth={200}
        />
      ))}
    </ChipRowShell>
  );
}
