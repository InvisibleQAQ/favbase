import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';

import Chip from '@mui/material/Chip';

import { Iconify } from '../iconify';
import { ChipRowShell, FilterChip } from './chip-row';

export interface CollapsibleChipRowProps<T> {
  /** Header icon, e.g. an <Iconify width={20}> — caller controls color. */
  icon: ReactNode;
  /** Pre-translated header title. */
  title: string;
  /** Optional extra header content, e.g. a clear-filter button. */
  headerExtra?: ReactNode;
  /** Filterable items, pre-sorted by the caller (e.g. count descending). */
  items: T[];
  /** Stable id for an item — also the value handed to onSelect. */
  getKey: (item: T) => string;
  /** Pre-translated chip label (caller formats name + count). */
  getLabel: (item: T) => string;
  /** Pre-translated "All (n)" chip label. */
  allLabel?: string;
  /** null = "All" selected; otherwise one or more selected item keys. */
  selected: string | string[] | null;
  onSelect: (key: string | null) => void;
  /** Pre-translated show-more label, given the hidden overflow count. */
  showMoreLabel: (overflow: number) => string;
  /** Pre-translated show-less label. */
  showLessLabel: string;
  /** Items shown before the show-more toggle. */
  collapsedCount?: number;
  /** Ellipsis truncation width for item chips. */
  maxWidth?: number;
  /** Optional leading icon for each item chip. */
  getIcon?: (item: T) => ReactElement | undefined;
  /** Optional overrides forwarded to the `ChipRowShell` (merged after its default `mb: 3`). */
  sx?: SxProps<Theme>;
}

export function resolveCollapsedItems<T>(
  items: T[],
  getKey: (item: T) => string,
  selected: string | string[] | null,
  collapsedCount: number,
  expanded: boolean,
) {
  const overflow = items.length - collapsedCount;
  const visible = expanded || overflow <= 0 ? items : items.slice(0, collapsedCount);
  const visibleKeys = new Set(visible.map(getKey));
  const selectedKeys = new Set(
    selected == null ? [] : Array.isArray(selected) ? selected : [selected],
  );
  const selectedHidden = items.filter(
    (item) => selectedKeys.has(getKey(item)) && !visibleKeys.has(getKey(item)),
  );

  return { overflow, visible, selectedKeys, selectedHidden };
}

/** Filter chip row for an unbounded set (authors, collections, …): an "All"
 *  chip + one chip per item, collapsed to the top N with a show-more/less
 *  toggle. The active chip stays reachable when collapsed, so filtering never
 *  hides the current selection below the fold. Zero t() — all copy arrives
 *  pre-translated via props (mirrors this dir's other shells). */
export function CollapsibleChipRow<T>({
  icon,
  title,
  headerExtra,
  items,
  getKey,
  getLabel,
  allLabel,
  selected,
  onSelect,
  showMoreLabel,
  showLessLabel,
  collapsedCount = 8,
  maxWidth = 220,
  getIcon,
  sx,
}: CollapsibleChipRowProps<T>) {
  const [expanded, setExpanded] = useState(false);

  const { overflow, visible, selectedKeys, selectedHidden } = resolveCollapsedItems(
    items,
    getKey,
    selected,
    collapsedCount,
    expanded,
  );
  const collapsible = overflow > 0;

  return (
    <ChipRowShell icon={icon} title={title} headerExtra={headerExtra} sx={sx}>
      {allLabel != null && (
        <FilterChip label={allLabel} selected={selected === null} onClick={() => onSelect(null)} />
      )}
      {visible.map((item) => {
        const key = getKey(item);
        return (
          <FilterChip
            key={key}
            label={getLabel(item)}
            selected={selectedKeys.has(key)}
            onClick={() => onSelect(key)}
            maxWidth={maxWidth}
            icon={getIcon?.(item)}
          />
        );
      })}
      {selectedHidden.map((item) => (
        <FilterChip
          key={`selected-${getKey(item)}`}
          label={getLabel(item)}
          selected
          onClick={() => onSelect(getKey(item))}
          maxWidth={maxWidth}
          icon={getIcon?.(item)}
        />
      ))}
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
