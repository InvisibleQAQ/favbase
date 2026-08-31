import Button from '@mui/material/Button';

import { useTranslation } from '@/lib/i18n/use-translation';
import type { UsedTag } from '@/lib/tagging';
import { Iconify } from '../iconify';
import { CollapsibleChipRow } from '../collection';

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
    <CollapsibleChipRow
      icon={<Iconify icon="mdi:tag" width={18} />}
      title={t('tags.sectionTitle')}
      items={tags}
      getKey={(tag) => tag.id}
      getLabel={(tag) => `${tag.name} (${tag.count})`}
      selected={selectedIds}
      onSelect={(key) => key != null && onToggle(key)}
      showMoreLabel={(n) => t('tags.showMore', { n })}
      showLessLabel={t('tags.showLess')}
      headerExtra={
        selectedIds.length > 0 && (
          <Button size="small" variant="text" onClick={onClear} sx={{ minWidth: 0, px: 1, py: 0 }}>
            {t('tags.clearFilter')}
          </Button>
        )
      }
    />
  );
}
