import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { CollapsibleChipRow } from '../../components/collection';
import type { AuthorCount } from '@/lib/x/x-sync-service';

interface AuthorChipsProps {
  authors: AuthorCount[];
  /** Unfiltered library size — count for the "All" chip. */
  totalCount: number;
  /** null = "All" selected. Value is the author handle. */
  selected: string | null;
  onSelect: (authorHandle: string | null) => void;
}

function authorLabel({ authorName, authorHandle, count }: AuthorCount): string {
  return `${authorName || authorHandle} (${count})`;
}

/** Author filter row: an "All" chip + one chip per author (name + count,
 *  descending by bookmark count — mirrors github's language chips), collapsed
 *  to the top N with a show-more/less toggle so a large author set stays tidy. */
export function AuthorChips({ authors, totalCount, selected, onSelect }: AuthorChipsProps) {
  const { t } = useTranslation();

  return (
    <CollapsibleChipRow
      icon={<Iconify icon="mdi:twitter" width={20} sx={{ color: 'primary.main' }} />}
      title={t('x.authorsTitle')}
      items={authors}
      getKey={(a) => a.authorHandle}
      getLabel={authorLabel}
      allLabel={`${t('x.allAuthors')} (${totalCount})`}
      selected={selected}
      onSelect={onSelect}
      showMoreLabel={(n) => t('x.showMoreAuthors', { n })}
      showLessLabel={t('x.showLessAuthors')}
    />
  );
}
