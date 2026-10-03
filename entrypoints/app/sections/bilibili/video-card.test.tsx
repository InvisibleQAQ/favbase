// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chipClasses, getChipUtilityClass } from '@mui/material/Chip';

import type { BiliFavVideo } from '@/lib/bilibili/types';
import type { VideoTranscribeState } from './use-video-transcribe';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
  formatCompactNumber: (n: number) => String(n),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({}),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: () => <span aria-hidden="true" />,
}));

// Leaf files, not the barrels: the collection barrel carries the scaffold (and
// library-gate's load-time storage read), the tags barrel loads `@/lib/tagging`.
vi.mock('../../components/collection', async () => import('../../components/collection/collection-card'));
vi.mock('../../components/tags', () => ({ TagRow: () => null }));

import { ThemeProvider } from '../../theme/theme-provider';
import { VideoCard } from './video-card';

const VIDEO: BiliFavVideo = {
  id: 1,
  type: 2,
  title: 'A video',
  cover: '',
  intro: '',
  duration: 61,
  bvid: 'BV1xx411c7mD',
  upper: { mid: 2, name: 'An uploader', face: '' },
  cnt_info: { play: 3, collect: 0, danmaku: 0 },
  fav_time: 0,
  attr: 0,
};

function state(overrides: Partial<VideoTranscribeState>): VideoTranscribeState {
  return {
    contentStatus: 'none',
    transcribing: false,
    progress: 0,
    stage: '',
    error: null,
    retryCountdown: 0,
    indexed: false,
    ...overrides,
  };
}

// The four action-bar chips are colored by meaning on the theme's default
// `soft` skin (ui-design-system.md section 9): actions `primary`, "has a
// transcript" `info`, "searchable" `secondary`. None of them is `outlined`.
describe('VideoCard action-bar chip colors', () => {
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

  function chips(transcribeState: VideoTranscribeState): HTMLElement[] {
    act(() => {
      root.render(
        <ThemeProvider>
          <VideoCard video={VIDEO} transcribeState={transcribeState} onTranscribe={vi.fn()} />
        </ThemeProvider>,
      );
    });
    const found = [...container.querySelectorAll<HTMLElement>(`.${chipClasses.root}`)];
    for (const chip of found) {
      expect(chip.classList.contains(getChipUtilityClass('soft')), chip.textContent ?? '').toBe(true);
      expect(chip.classList.contains(chipClasses.outlined), chip.textContent ?? '').toBe(false);
    }
    return found;
  }

  it('renders transcribe as a clickable primary chip', () => {
    const [transcribe, ...rest] = chips(state({ contentStatus: 'none' }));
    expect(rest).toHaveLength(0);
    expect(transcribe.textContent).toBe('card.transcribe');
    expect(transcribe.classList.contains(chipClasses.colorPrimary)).toBe(true);
    expect(transcribe.classList.contains(chipClasses.clickable)).toBe(true);
  });

  it('renders retry as a clickable primary chip', () => {
    const [retry, ...rest] = chips(state({ error: { code: 'DOWNLOAD_FAILED', message: 'failed' } }));
    expect(rest).toHaveLength(0);
    expect(retry.textContent).toBe('transcribe.retry');
    expect(retry.classList.contains(chipClasses.colorPrimary)).toBe(true);
    expect(retry.classList.contains(chipClasses.clickable)).toBe(true);
  });

  it('renders the transcript source as info and the indexed badge as secondary, neither clickable', () => {
    const [source, indexed, ...rest] = chips(state({ contentStatus: 'has_asr', indexed: true }));
    expect(rest).toHaveLength(0);
    expect(source.textContent).toBe('card.sourceASR');
    expect(source.classList.contains(chipClasses.colorInfo)).toBe(true);
    expect(source.classList.contains(chipClasses.clickable)).toBe(false);
    expect(indexed.textContent).toBe('card.indexed');
    expect(indexed.classList.contains(chipClasses.colorSecondary)).toBe(true);
    expect(indexed.classList.contains(chipClasses.clickable)).toBe(false);
  });
});
