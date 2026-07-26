// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AutoTranscribeState } from '@/lib/auto-transcribe/types';

vi.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) =>
    params?.count !== undefined
      ? `${key}:${params.count}`
      : params?.reset !== undefined
        ? `${key}:${params.reset}`
        : key,
  formatDateTime: (timestamp: number) => `date:${timestamp}`,
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({}),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: () => <span aria-hidden="true" />,
}));

import { AutoTranscribeBar } from './auto-transcribe-bar';

function idleState(overrides: Partial<AutoTranscribeState> = {}): AutoTranscribeState {
  return {
    phase: 'idle',
    currentPage: 0,
    totalPages: 0,
    currentVideoTitle: '',
    currentVideoId: '',
    currentVideo: null,
    totalVideos: 0,
    currentIndex: 0,
    videoProgress: 0,
    videoStage: '',
    waitSeconds: 0,
    quotaResetAt: null,
    stats: { existing: 0, cc: 0, asr: 0, skipped: 0, remaining: 0 },
    previewVideo: null,
    pendingCount: null,
    previewLoading: false,
    ...overrides,
  };
}

describe('AutoTranscribeBar unsynced preview', () => {
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

  it('exposes the existing start action without inventing a pending count', () => {
    const onStart = vi.fn();

    act(() => {
      root.render(
        <AutoTranscribeBar
          state={idleState()}
          running={false}
          onStart={onStart}
          onStop={vi.fn()}
        />,
      );
    });

    const startButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('autoTranscribe.startBtn'),
    );
    expect(startButton).toBeDefined();
    expect(container.textContent).not.toContain('autoTranscribe.pendingCount');

    act(() => startButton?.click());
    expect(onStart).toHaveBeenCalledOnce();
  });

  it('blocks restart until the quota reset and still requires an explicit click', () => {
    const onStart = vi.fn();
    const render = (waitSeconds: number) => {
      root.render(
        <AutoTranscribeBar
          state={idleState({
            phase: 'quota_paused',
            quotaResetAt: 4_600_000,
            waitSeconds,
          })}
          running={false}
          onStart={onStart}
          onStop={vi.fn()}
        />,
      );
    };

    act(() => render(60));

    expect(container.textContent).toContain('autoTranscribe.quotaPausedUntil');
    expect(container.textContent).toContain('date:4600000');
    const restartButton = container.querySelector('button');
    expect(restartButton?.disabled).toBe(true);

    act(() => render(0));

    expect(onStart).not.toHaveBeenCalled();
    expect(restartButton?.disabled).toBe(false);
    act(() => restartButton?.click());
    expect(onStart).toHaveBeenCalledOnce();
  });
});
