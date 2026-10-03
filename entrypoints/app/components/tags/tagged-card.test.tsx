// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PagedItemRow } from '@/lib/database/collection-queries';
import type { TaggedItem, TagRef } from '@/lib/tagging';
// Leaf file, not the barrel: the barrel's hooks load `@/lib/tagging` values.
import { taggedCard } from './tagged-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface StubItem {
  fromRow: PagedItemRow;
}

interface StubCardProps {
  entry: StubItem;
  tags?: TagRef[];
  onEditTags?: (anchor: HTMLElement) => void;
}

const ITEM: TaggedItem = {
  itemId: 'item-uuid',
  platform: 'p',
  platformItemId: 'native-id',
  title: 'A title',
  authorName: 'An author',
  originalUrl: 'https://example.com/a',
  publishedAt: new Date('2026-01-02T03:04:05Z'),
  platformMeta: { k: 'v' },
  tags: [{ id: 't1', name: 'tag one' }],
};

describe('taggedCard', () => {
  let container: HTMLDivElement;
  let root: Root;
  let received: StubCardProps[];

  function StubCard(props: StubCardProps) {
    received.push(props);
    return <article data-stub-card />;
  }

  beforeEach(() => {
    received = [];
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(toItem: (row: PagedItemRow) => StubItem, onEditTags = vi.fn()) {
    const Adapter = taggedCard(StubCard, 'entry', toItem);
    act(() => root.render(<Adapter item={ITEM} onEditTags={onEditTags} />));
    return onEditTags;
  }

  it('hands the mapper the items row: id is the itemId, the other six fields verbatim', () => {
    const toItem = vi.fn((row: PagedItemRow): StubItem => ({ fromRow: row }));
    render(toItem);

    expect(toItem).toHaveBeenCalledTimes(1);
    // Strict: exactly the seven `PagedItemRow` columns — no `itemId`,
    // `platform` or `tags` leaking into what the lib `mapRow` sees.
    expect(toItem.mock.calls[0]![0]).toStrictEqual({
      id: 'item-uuid',
      platformItemId: 'native-id',
      title: 'A title',
      authorName: 'An author',
      originalUrl: 'https://example.com/a',
      publishedAt: ITEM.publishedAt,
      platformMeta: { k: 'v' },
    });
  });

  it("puts the mapper's result on the card's item prop and passes tags / onEditTags through", () => {
    const mapped: StubItem = { fromRow: {} as PagedItemRow };
    const onEditTags = render(() => mapped);

    expect(container.querySelector('[data-stub-card]')).not.toBeNull();
    expect(received).toHaveLength(1);
    const props = received[0]!;
    expect(Object.keys(props).sort()).toEqual(['entry', 'onEditTags', 'tags']);
    expect(props.entry).toBe(mapped);
    expect(props.tags).toBe(ITEM.tags);
    expect(props.onEditTags).toBe(onEditTags);
  });
});
