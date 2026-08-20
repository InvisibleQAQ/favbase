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
    asrBlocked: false,
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
    ...overrides,
  };
}

describe('AutoTranscribeBar (pure progress display)', () => {
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

  it('draws nothing while idle — the pipeline strip already carries Transcribe coverage', () => {
    act(() => {
      root.render(<AutoTranscribeBar state={idleState()} running={false} />);
    });

    expect(container.childElementCount).toBe(0);
    expect(container.textContent).toBe('');
  });

  it('summarises a finished run on one passive status line without controls', () => {
    act(() => {
      root.render(
        <AutoTranscribeBar
          state={idleState({
            phase: 'done',
            stats: { existing: 2, cc: 1, asr: 0, skipped: 0, remaining: 0 },
          })}
          running={false}
        />,
      );
    });

    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.textContent).toContain('autoTranscribe.doneTitle');
    expect(container.textContent).toContain('autoTranscribe.statsExisting:2');
    expect(container.querySelector('button')).toBeNull();
  });

  it('shows the auto-resume quota copy as a status line, not an alert, without a restart control', () => {
    act(() => {
      root.render(
        <AutoTranscribeBar
          state={idleState({
            phase: 'quota_paused',
            quotaResetAt: 4_600_000,
            waitSeconds: 60,
          })}
          running={false}
        />,
      );
    });

    expect(container.textContent).toContain('autoTranscribe.quotaPausedUntil');
    expect(container.textContent).toContain('date:4600000');
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders the running panel without a stop control', () => {
    act(() => {
      root.render(
        <AutoTranscribeBar
          state={idleState({
            phase: 'transcribing',
            totalVideos: 3,
            currentIndex: 1,
            currentVideo: { cover: '', title: 'BV-1', author: 'UP', duration: 60 },
          })}
          running
        />,
      );
    });

    expect(container.textContent).toContain('BV-1');
    expect(container.querySelector('button')).toBeNull();
  });

  it('does not duplicate the shared configuration notice for the ASR wait state', () => {
    act(() => {
      root.render(
        <AutoTranscribeBar
          state={idleState({ phase: 'configuration_required' })}
          running
        />,
      );
    });

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('a')).toBeNull();
  });
});
