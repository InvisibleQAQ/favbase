import { useState } from 'react';

import Chip from '@mui/material/Chip';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ChipRowShell, FilterChip } from '../../components/collection';
import type { AuthorCount } from '@/lib/x/x-sync-service';

/** Authors shown while collapsed, before the show-more toggle. Authors are
 *  unbounded (one per bookmarked account), unlike bounded folder/language rows. */
const COLLAPSED_COUNT = 12;

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
  const [expanded, setExpanded] = useState(false);

  const overflow = authors.length - COLLAPSED_COUNT;
  const collapsible = overflow > 0;
  const visible = expanded || !collapsible ? authors : authors.slice(0, COLLAPSED_COUNT);

  // Keep the active author reachable when collapsed so filtering never hides
  // the currently-selected chip below the fold.
  const selectedHidden =
    selected != null && !visible.some((a) => a.authorHandle === selected)
      ? authors.find((a) => a.authorHandle === selected)
      : undefined;

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
      {visible.map((author) => (
        <FilterChip
          key={author.authorHandle}
          label={authorLabel(author)}
          selected={author.authorHandle === selected}
          onClick={() => onSelect(author.authorHandle)}
          maxWidth={220}
        />
      ))}
      {selectedHidden && (
        <FilterChip
          key={selectedHidden.authorHandle}
          label={authorLabel(selectedHidden)}
          selected
          onClick={() => onSelect(selectedHidden.authorHandle)}
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
          label={expanded ? t('x.showLessAuthors') : t('x.showMoreAuthors', { n: overflow })}
        />
      )}
    </ChipRowShell>
  );
}
