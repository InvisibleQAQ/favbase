import type { LocaleKeys } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify, type IconifyName } from '../iconify';
// Leaf file, not the `../collection` barrel — same reason as `collection-states.tsx`.
import { CollapsibleChipRow } from '../collection/collapsible-chip-row';

export interface FacetChipsProps<T extends { count: number }> {
  icon: IconifyName;
  title: LocaleKeys;
  facets: T[];
  /** The facet's id — also the value handed to `onSelect`. */
  getKey: (facet: T) => string;
  /** Display name; an empty name falls back to the key. */
  getName: (facet: T) => string;
  /** Unfiltered library size — count for the "All" chip. */
  totalCount: number;
  /** null = "All" selected. */
  selected: string | null;
  onSelect: (key: string | null) => void;
}

/**
 * Single-select filter row for one counted facet — a Creator or a Source: an
 * "All (total)" chip, then one "name (count)" chip per facet, collapsed to the
 * top N by the shared `CollapsibleChipRow`. Chip order is whatever the caller's
 * facet query returns (count descending today); this component never sorts.
 * Facet shapes stay the platform's own — the caller reads them through
 * `getKey` / `getName`.
 */
export function FacetChips<T extends { count: number }>({
  icon,
  title,
  facets,
  getKey,
  getName,
  totalCount,
  selected,
  onSelect,
}: FacetChipsProps<T>) {
  const { t } = useTranslation();

  return (
    <CollapsibleChipRow
      icon={<Iconify icon={icon} width={20} />}
      title={t(title)}
      items={facets}
      getKey={getKey}
      getLabel={(f) => `${getName(f) || getKey(f)} (${f.count})`}
      allLabel={`${t('common.all')} (${totalCount})`}
      selected={selected}
      onSelect={onSelect}
      showMoreLabel={(n) => t('common.showMore', { n })}
      showLessLabel={t('common.showLess')}
    />
  );
}
