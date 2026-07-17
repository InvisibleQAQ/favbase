import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollapsibleChipRow } from '../../components/collection';
import type { ZhihuCollectionCount } from '@/lib/zhihu/zhihu-sync-service';

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

  return (
    <CollapsibleChipRow
      icon={<Iconify icon="simple-icons:zhihu" width={20} sx={{ color: 'primary.main' }} />}
      title={t('zhihu.collectionsTitle')}
      items={collections}
      getKey={(c) => c.collectionId}
      getLabel={collectionLabel}
      allLabel={`${t('zhihu.allCollections')} (${totalCount})`}
      selected={selected}
      onSelect={onSelect}
      showMoreLabel={(n) => t('zhihu.showMoreCollections', { n })}
      showLessLabel={t('zhihu.showLessCollections')}
    />
  );
}
