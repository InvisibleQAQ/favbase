import { useState } from 'react';
import type { ReactNode } from 'react';

import Chip from '@mui/material/Chip';

import { Iconify } from '../iconify';
import { ChipRowShell, FilterChip } from './chip-row';

export interface CollapsibleChipRowProps<T> {
  /** Header icon, e.g. an <Iconify width={20}> — caller controls color. */
  icon: ReactNode;
  /** Pre-translated header title. */
  title: string;
  /** Filterable items, pre-sorted by the caller (e.g. count descending). */
  items: T[];
  /** Stable id for an item — also the value handed to onSelect. */
  getKey: (item: T) => string;
  /** Pre-translated chip label (caller formats name + count). */
  getLabel: (item: T) => string;
  /** Pre-translated "All (n)" chip label. */
  allLabel: string;
  /** null = "All" selected; otherwise the selected item's key. */
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Pre-translated show-more label, given the hidden overflow count. */
  showMoreLabel: (overflow: number) => string;
  /** Pre-translated show-less label. */
  showLessLabel: string;
  /** Items shown before the show-more toggle. */
  collapsedCount?: number;
  /** Ellipsis truncation width for item chips. */
  maxWidth?: number;
}

/** Filter chip row for an unbounded set (authors, collections, …): an "All"
 *  chip + one chip per item, collapsed to the top N with a show-more/less
 *  toggle. The active chip stays reachable when collapsed, so filtering never
 *  hides the current selection below the fold. Zero t() — all copy arrives
 *  pre-translated via props (mirrors this dir's other shells). */
export function CollapsibleChipRow<T>({
  icon,
  title,
  items,
  getKey,
  getLabel,
  allLabel,
  selected,
  onSelect,
  showMoreLabel,
  showLessLabel,
  collapsedCount = 12,
  maxWidth = 220,
}: CollapsibleChipRowProps<T>) {
  const [expanded, setExpanded] = useState(false);

  const overflow = items.length - collapsedCount;
  const collapsible = overflow > 0;
  const visible = expanded || !collapsible ? items : items.slice(0, collapsedCount);

  const selectedHidden =
    selected != null && !visible.some((item) => getKey(item) === selected)
      ? items.find((item) => getKey(item) === selected)
      : undefined;

  return (
    <ChipRowShell icon={icon} title={title}>
      <FilterChip label={allLabel} selected={selected === null} onClick={() => onSelect(null)} />
      {visible.map((item) => {
        const key = getKey(item);
        return (
          <FilterChip
            key={key}
            label={getLabel(item)}
            selected={key === selected}
            onClick={() => onSelect(key)}
            maxWidth={maxWidth}
          />
        );
      })}
      {selectedHidden && (
        <FilterChip
          label={getLabel(selectedHidden)}
          selected
          onClick={() => onSelect(getKey(selectedHidden))}
          maxWidth={maxWidth}
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
          label={expanded ? showLessLabel : showMoreLabel(overflow)}
        />
      )}
    </ChipRowShell>
  );
}
