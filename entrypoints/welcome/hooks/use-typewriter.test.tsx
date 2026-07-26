// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Only useReducedMotion is needed from motion, and stubbing it keeps the test
// off matchMedia plumbing while letting each case pick a preference.
let reduceMotion = false;
vi.mock('motion/react', () => ({ useReducedMotion: () => reduceMotion }));

import { useTypewriter, type Typewriter } from './use-typewriter';

const TEXT = 'abcde';

function renderHook(container: HTMLElement) {
  const seen: Typewriter[] = [];

  function Probe({ active }: { active: boolean }) {
    seen.push(useTypewriter(TEXT, active, 10));
    return null;
  }

  const root = createRoot(container);
  return {
    root,
    seen,
    render(active: boolean) {
      act(() => root.render(<Probe active={active} />));
    },
    latest: () => seen[seen.length - 1],
  };
}

let container: HTMLElement;
let root: Root | undefined;

beforeEach(() => {
  reduceMotion = false;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.useRealTimers();
});

describe('useTypewriter', () => {
  it('reveals nothing until activated', () => {
    const hook = renderHook(container);
    root = hook.root;

    hook.render(false);
    expect(hook.latest()).toEqual({ visible: '', done: false });

    act(() => void vi.advanceTimersByTime(100));
    expect(hook.latest().visible).toBe('');
  });

  it('reveals one character per tick once active', () => {
    const hook = renderHook(container);
    root = hook.root;

    hook.render(true);
    act(() => void vi.advanceTimersByTime(10));
    expect(hook.latest().visible).toBe('a');

    act(() => void vi.advanceTimersByTime(20));
    expect(hook.latest().visible).toBe('abc');
  });

  it('reports done only after the last character', () => {
    const hook = renderHook(container);
    root = hook.root;

    hook.render(true);
    act(() => void vi.advanceTimersByTime(40));
    expect(hook.latest().done).toBe(false);

    act(() => void vi.advanceTimersByTime(10));
    expect(hook.latest()).toEqual({ visible: TEXT, done: true });
  });

  it('stops ticking at the end instead of spinning forever', () => {
    const hook = renderHook(container);
    root = hook.root;

    hook.render(true);
    act(() => void vi.advanceTimersByTime(200));
    expect(hook.latest()).toEqual({ visible: TEXT, done: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rewinds when deactivated so a re-entry replays', () => {
    const hook = renderHook(container);
    root = hook.root;

    hook.render(true);
    act(() => void vi.advanceTimersByTime(30));
    expect(hook.latest().visible).toBe('abc');

    hook.render(false);
    expect(hook.latest()).toEqual({ visible: '', done: false });
  });

  // A streaming animation has no calm variant worth showing — it lands whole.
  it('lands the full string immediately under reduced motion', () => {
    reduceMotion = true;
    const hook = renderHook(container);
    root = hook.root;

    hook.render(true);
    expect(hook.latest()).toEqual({ visible: TEXT, done: true });
    expect(vi.getTimerCount()).toBe(0);
  });
});
