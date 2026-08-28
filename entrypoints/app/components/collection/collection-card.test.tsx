// @vitest-environment happy-dom

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider } from '../../theme/theme-provider';
import {
  CollectionCard,
  CollectionCardRow,
  CollectionCardSkeleton,
  CoverBadge,
} from './collection-card';

const themed = (node: ReactElement) => <ThemeProvider>{node}</ThemeProvider>;

describe('CollectionCard shell contract', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('opens the original URL through a real anchor in a new tab', () => {
    act(() => {
      root.render(themed(<CollectionCard href="https://example.com/a" title="Entry" />));
    });

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/a');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    // The title is a paragraph, not a heading: one page, one h1.
    const title = container.querySelector('[data-slot="title"]');
    expect(title?.tagName).toBe('P');
    expect(title?.getAttribute('title')).toBe('Entry');
  });

  it('renders no link and dims the entry when disabled', () => {
    act(() => {
      root.render(themed(<CollectionCard href="https://example.com/a" title="Gone" disabled />));
    });

    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-collection-card]')).not.toBeNull();
  });

  it('renders no tag row and no footer when they are not provided', () => {
    act(() => {
      root.render(themed(<CollectionCard title="Entry" />));
    });

    expect(container.querySelector('[data-slot="tags"]')).toBeNull();
    expect(container.querySelector('[data-slot="meta-row"]')).toBeNull();
    expect(container.querySelector('[data-slot="stats-row"]')).toBeNull();
  });

  it('keeps the date in its own non-wrapping grid cell next to the meta cell', () => {
    act(() => {
      root.render(themed(<CollectionCard
          title="Entry"
          meta={<span data-testid="meta">author with a very long name</span>}
          date="8/19/26, 9:09 PM"
        />));
    });

    const date = container.querySelector('[data-slot="date"]');
    expect(date?.textContent).toBe('8/19/26, 9:09 PM');
    expect(date?.getAttribute('title')).toBe('8/19/26, 9:09 PM');
    expect(date?.className).toMatch(/noWrap/);
    expect(container.querySelector('[data-slot="meta"] [data-testid="meta"]')).not.toBeNull();
  });

  it('swaps a broken cover for the platform fallback glyph', () => {
    act(() => {
      root.render(themed(<CollectionCard
          title="Entry"
          media={{
            src: 'https://example.com/404.jpg',
            alt: 'Entry',
            aspect: '16/9',
            fallbackIcon: <span data-testid="fallback" />,
            overlay: <CoverBadge>12:34</CoverBadge>,
          }}
        />));
    });

    const slot = container.querySelector('[data-slot="media"]');
    expect(slot?.getAttribute('data-media-state')).toBe('image');
    expect(container.querySelector('[data-testid="fallback"]')).toBeNull();

    act(() => {
      container.querySelector('img')?.dispatchEvent(new Event('error'));
    });

    expect(slot?.getAttribute('data-media-state')).toBe('fallback');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="fallback"]')).not.toBeNull();
    // Overlays survive the fallback: the duration still reads on the placeholder.
    expect(slot?.textContent).toContain('12:34');
  });

  it('shows the fallback glyph immediately when there is no cover, and no slot for aspect none', () => {
    act(() => {
      root.render(themed(<CollectionCard
          title="Entry"
          media={{ src: null, alt: 'Entry', aspect: '1/1', fallbackIcon: <span data-testid="fallback" /> }}
        />));
    });
    expect(container.querySelector('[data-testid="fallback"]')).not.toBeNull();

    act(() => {
      root.render(themed(<CollectionCard
          title="Entry"
          media={{ src: 'x', alt: 'Entry', aspect: 'none', fallbackIcon: <span data-testid="fallback" /> }}
        />));
    });
    expect(container.querySelector('[data-slot="media"]')).toBeNull();
  });

  it('keeps the header row full-width and places the 1/1 thumb beside the body, never beside the header', () => {
    act(() => {
      root.render(
        themed(
          <CollectionCard
            title="Entry"
            header={<span data-testid="author">a very long author name that must not be squeezed</span>}
            body={<span data-testid="body">excerpt</span>}
            date="today"
            media={{ src: 'https://example.com/t.jpg', alt: '', aspect: '1/1', fallbackIcon: <span /> }}
          />,
        ),
      );
    });

    const header = container.querySelector('[data-slot="header"]');
    const bodyRow = container.querySelector('[data-slot="body-row"]');
    const media = container.querySelector('[data-slot="media"]');
    expect(header).not.toBeNull();
    expect(media).not.toBeNull();
    // The thumb is not inside the header row…
    expect(header?.querySelector('[data-slot="media"]')).toBeNull();
    // …it lives in the body row that directly follows the header in the same
    // column, so the header spans the full content width.
    expect(header?.nextElementSibling).toBe(bodyRow);
    expect(bodyRow?.querySelector('[data-slot="media"]')).toBe(media);
    expect(bodyRow?.querySelector('[data-slot="title"]')).not.toBeNull();
    expect(bodyRow?.querySelector('[data-testid="body"]')).not.toBeNull();
    // The thumb is the last cell of the body row (right side); the meta row is a
    // later full-width sibling of the body row, not of the thumb.
    expect(bodyRow?.lastElementChild).toBe(media);
    expect(container.querySelector('[data-slot="meta-row"]')?.parentElement?.previousElementSibling).toBe(bodyRow);
  });

  it('renders tags and footer outside the link', () => {
    act(() => {
      root.render(themed(<CollectionCard
          href="https://example.com/a"
          title="Entry"
          tags={<div data-slot="tags" />}
          footer={<button type="button" data-testid="action" />}
        />));
    });

    const link = container.querySelector('a');
    expect(link?.querySelector('[data-slot="tags"]')).toBeNull();
    expect(link?.querySelector('[data-testid="action"]')).toBeNull();
    expect(container.querySelector('[data-slot="tags"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="action"]')).not.toBeNull();
  });

  it('marks a disabled entry on the shell and keeps its title readable text', () => {
    act(() => {
      root.render(themed(<CollectionCard href="https://example.com/a" title="Gone" disabled />));
    });

    const card = container.querySelector('[data-collection-card]');
    expect(card?.hasAttribute('data-disabled')).toBe(true);
    // The title is still real text (no opacity shell): screen readers and
    // sighted users both get the state from the surface, not from illegibility.
    expect(container.querySelector('[data-slot="title"]')?.textContent).toBe('Gone');

    act(() => {
      root.render(themed(<CollectionCard href="https://example.com/a" title="Here" />));
    });
    expect(container.querySelector('[data-collection-card]')?.hasAttribute('data-disabled')).toBe(false);
  });

  it('lays out rows outside the link through CollectionCardRow, keeping their content', () => {
    act(() => {
      root.render(
        themed(
          <CollectionCard
            href="https://example.com/a"
            title="Entry"
            tags={
              <CollectionCardRow>
                <span data-testid="chip" />
              </CollectionCardRow>
            }
            footer={
              <CollectionCardRow>
                <button type="button" data-testid="action" />
              </CollectionCardRow>
            }
          />,
        ),
      );
    });

    const rows = container.querySelectorAll('[data-collection-card] > [data-slot="row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-testid="chip"]')).not.toBeNull();
    expect(rows[1].querySelector('[data-testid="action"]')).not.toBeNull();
    expect(container.querySelector('a [data-slot="row"]')).toBeNull();
  });
});

describe('CollectionCardSkeleton anatomy', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('mirrors the entry slots: top cover, side thumb or no media, optional header, N lines', () => {
    act(() => {
      root.render(themed(<CollectionCardSkeleton media="16/9" lines={2} />));
    });
    let skeleton = container.querySelector('[data-collection-card-skeleton]');
    expect(skeleton).not.toBeNull();
    // The cover precedes the content block, exactly like the real entry.
    expect(skeleton?.firstElementChild?.getAttribute('data-slot')).toBe('media');
    expect(skeleton?.querySelector('[data-slot="header"]')).toBeNull();
    expect(skeleton?.querySelectorAll('[data-slot="body-row"] .MuiSkeleton-text')).toHaveLength(2);

    act(() => {
      root.render(themed(<CollectionCardSkeleton media="1/1" header lines={3} />));
    });
    skeleton = container.querySelector('[data-collection-card-skeleton]');
    expect(skeleton?.firstElementChild?.getAttribute('data-slot')).toBe('content');
    expect(skeleton?.querySelector('[data-slot="header"]')).not.toBeNull();
    // The thumb is the last cell of the body row — beside the text, never the header.
    expect(skeleton?.querySelector('[data-slot="body-row"]')?.lastElementChild?.getAttribute('data-slot')).toBe('media');
    expect(skeleton?.querySelectorAll('[data-slot="body-row"] .MuiSkeleton-text')).toHaveLength(3);

    act(() => {
      root.render(themed(<CollectionCardSkeleton />));
    });
    expect(container.querySelector('[data-collection-card-skeleton] [data-slot="media"]')).toBeNull();
  });
});
