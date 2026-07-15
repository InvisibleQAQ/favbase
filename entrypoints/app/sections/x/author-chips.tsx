import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, FilterChip } from '../../components/collection';
import type { AuthorCount } from '@/lib/x/x-sync-service';

interface AuthorChipsProps {
  authors: AuthorCount[];
  /** Unfiltered library size — count for the "All" chip. */
  totalCount: number;
  /** null = "All" selected. Value is the author handle. */
  selected: string | null;
  onSelect: (authorHandle: string | null) => void;
}

/** Author filter row: an "All" chip + one chip per author (name + count,
 *  descending by bookmark count — mirrors github's language chips). */
export function AuthorChips({ authors, totalCount, selected, onSelect }: AuthorChipsProps) {
  const { t } = useTranslation();

  return (
    <ChipRowShell
      icon={<Iconify icon="mdi:twitter" width={20} sx={{ color: 'primary.main' }} />}
      title={t('x.authorsTitle')}
    >
      <FilterChip
        label={`${t('x.allAuthors')} (${totalCount})`}
        selected={selected === null}
        onClick={() => onSelect(null)}
      />
      {authors.map(({ authorName, authorHandle, count }) => (
        <FilterChip
          key={authorHandle}
          label={`${authorName || authorHandle} (${count})`}
          selected={authorHandle === selected}
          onClick={() => onSelect(authorHandle)}
          maxWidth={220}
        />
      ))}
    </ChipRowShell>
  );
}
