import { describe, expect, it } from 'vitest';

import { resolveCollapsedItems } from './collapsible-chip-row';

const items = Array.from({ length: 12 }, (_, index) => ({ id: String(index + 1) }));
const getKey = (item: { id: string }) => item.id;

describe('resolveCollapsedItems', () => {
  it('shows the first eight items and reports the hidden count', () => {
    const result = resolveCollapsedItems(items, getKey, null, 8, false);

    expect(result.visible.map(getKey)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(result.overflow).toBe(4);
  });

  it('keeps every selected item from the collapsed range reachable', () => {
    const result = resolveCollapsedItems(items, getKey, ['2', '10', '12'], 8, false);

    expect(result.selectedHidden.map(getKey)).toEqual(['10', '12']);
  });

  it('does not duplicate selected items when expanded', () => {
    const result = resolveCollapsedItems(items, getKey, ['10', '12'], 8, true);

    expect(result.visible).toEqual(items);
    expect(result.selectedHidden).toEqual([]);
  });
});
