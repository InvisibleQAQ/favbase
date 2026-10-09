// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chipClasses } from '@mui/material/Chip';

import type { DouyinItem } from '@/lib/douyin/douyin-sync-service';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
  formatDateTime: (value: number) => `date:${value}`,
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: () => <span aria-hidden="true" />,
}));

// Leaf files, not the barrels: the collection barrel carries the scaffold (and
// library-gate's load-time storage read), the tags barrel loads `@/lib/tagging`.
vi.mock('../../components/collection', async () => import('../../components/collection/collection-card'));
vi.mock('../../components/tags', () => ({ TagRow: () => null }));

import { ThemeProvider } from '../../theme/theme-provider';
import { DouyinCard } from './douyin-card';

function favorite(overrides: Partial<DouyinItem> = {}): DouyinItem {
  return {
    id: 'uuid-1',
    awemeId: '7300000000000000001',
    title: 'A clip',
    desc: 'A clip',
    authorName: 'Alice',
    authorSecUid: 'MS4w',
    avatarUrl: null,
    coverUrl: null,
    durationMs: 61_000,
    mediaKind: 'video',
    folderId: null,
    folderTitle: null,
    originalUrl: 'https://www.douyin.com/video/7300000000000000001',
    publishedAt: null,
    ...overrides,
  };
}

describe('DouyinCard subtitle-source badge', () => {
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

  function render(item: DouyinItem) {
    act(() => {
      root.render(
        <ThemeProvider>
          <DouyinCard favorite={item} />
        </ThemeProvider>,
      );
    });
    return [...container.querySelectorAll<HTMLElement>(`.${chipClasses.root}`)];
  }

  it('marks an ASR transcript with the shared ASR label in the info color, outside the link', () => {
    const [chip, ...rest] = render(favorite({ subtitleSource: 'asr' }));

    expect(rest).toHaveLength(0);
    expect(chip.textContent).toBe('card.sourceASR');
    expect(chip.classList.contains(chipClasses.colorInfo)).toBe(true);
    expect(chip.closest('a')).toBeNull();
  });

  it('marks an official subtitle track with the CC label', () => {
    const [chip] = render(favorite({ subtitleSource: 'official' }));
    expect(chip.textContent).toBe('card.sourceCC');
  });

  it('draws no badge while the Content is not a transcript or the row did not carry the column', () => {
    expect(render(favorite({ subtitleSource: null }))).toHaveLength(0);
    expect(render(favorite({ subtitleSource: undefined }))).toHaveLength(0);
  });
});
