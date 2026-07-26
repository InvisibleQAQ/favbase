// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gateState = vi.hoisted(() => ({
  paused: false,
  pause: vi.fn(),
  resume: vi.fn(),
}));

// The real gate hook reads WXT storage; stub it so this component test only
// exercises the toggle rendering + click wiring.
vi.mock('../../hooks/library-gate', () => ({
  gatePlatformOf: (platform: string) => (platform === 'not-a-platform' ? null : 'github'),
  useLibraryGate: () => gateState,
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../iconify', () => ({
  Iconify: () => <span aria-hidden="true" />,
}));

import { LibraryGateButton } from './library-gate-button';

describe('LibraryGateButton', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    gateState.paused = false;
    gateState.pause.mockClear();
    gateState.resume.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('offers Pause while running and calls pause on click', () => {
    act(() => root.render(<LibraryGateButton platform="github-stars" />));

    const button = container.querySelector('[data-library-gate]') as HTMLButtonElement;
    expect(button.getAttribute('data-gate-state')).toBe('running');
    expect(button.textContent).toContain('pipeline.pauseLibrary');

    act(() => button.click());
    expect(gateState.pause).toHaveBeenCalledOnce();
    expect(gateState.resume).not.toHaveBeenCalled();
  });

  it('offers Resume while paused and calls resume on click', () => {
    gateState.paused = true;
    act(() => root.render(<LibraryGateButton platform="github-stars" />));

    const button = container.querySelector('[data-library-gate]') as HTMLButtonElement;
    expect(button.getAttribute('data-gate-state')).toBe('paused');
    expect(button.textContent).toContain('pipeline.resumeLibrary');

    act(() => button.click());
    expect(gateState.resume).toHaveBeenCalledOnce();
    expect(gateState.pause).not.toHaveBeenCalled();
  });

  it('renders nothing for a string that is not a gated platform', () => {
    act(() => root.render(<LibraryGateButton platform="not-a-platform" />));

    expect(container.querySelector('[data-library-gate]')).toBeNull();
  });
});
