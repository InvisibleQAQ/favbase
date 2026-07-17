import { useState } from 'react';

import Chip from '@mui/material/Chip';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, FilterChip } from '../../components/collection';
import type { ZhihuCollectionCount } from '@/lib/zhihu/zhihu-sync-service';

/** Collections shown while collapsed, before the show-more toggle (a zhihu
 *  account can own many collections — mirrors the x author-chips fold). */
const COLLAPSED_COUNT = 12;

interface CollectionChipsProps {
  collections: ZhihuCollectionCount[];
  /** Unfiltered library size — count for the "All" chip. */
  totalCount: number;
  /** null = "All" selected. Value is the collection id. */
  selected: string | null;
  onSelect: (collectionId: string | null) => void;
}

function collectionLabel({ title, collectionId, count }: ZhihuCollectionCount): string {
  return `${title || collectionId} (${count})`;
}

/** Collection filter row: an "All" chip + one chip per collection (title +
 *  count, descending by item count), collapsed to the top N with a
 *  show-more/less toggle. */
export function CollectionChips({
  collections,
  totalCount,
  selected,
  onSelect,
}: CollectionChipsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const overflow = collections.length - COLLAPSED_COUNT;
  const collapsible = overflow > 0;
  const visible = expanded || !collapsible ? collections : collections.slice(0, COLLAPSED_COUNT);

  // Keep the active collection reachable when collapsed so filtering never
  // hides the currently-selected chip below the fold.
  const selectedHidden =
    selected != null && !visible.some((c) => c.collectionId === selected)
      ? collections.find((c) => c.collectionId === selected)
      : undefined;

  return (
    <ChipRowShell
      icon={<Iconify icon="simple-icons:zhihu" width={20} sx={{ color: 'primary.main' }} />}
      title={t('zhihu.collectionsTitle')}
    >
      <FilterChip
        label={`${t('zhihu.allCollections')} (${totalCount})`}
        selected={selected === null}
        onClick={() => onSelect(null)}
      />
      {visible.map((collection) => (
        <FilterChip
          key={collection.collectionId}
          label={collectionLabel(collection)}
          selected={collection.collectionId === selected}
          onClick={() => onSelect(collection.collectionId)}
          maxWidth={220}
        />
      ))}
      {selectedHidden && (
        <FilterChip
          key={selectedHidden.collectionId}
          label={collectionLabel(selectedHidden)}
          selected
          onClick={() => onSelect(selectedHidden.collectionId)}
          maxWidth={220}
        />
      )}
      {collapsible && (
        <Chip
          clickable
          variant="outlined"
          onClick={() => setExpanded((v) => !v)}
          icon={
            <Iconify
              icon={expanded ? 'eva:arrow-ios-upward-fill' : 'eva:arrow-ios-downward-fill'}
              width={16}
            />
          }
          label={expanded ? t('zhihu.showLessCollections') : t('zhihu.showMoreCollections', { n: overflow })}
        />
      )}
    </ChipRowShell>
  );
}
