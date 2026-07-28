// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CollectionPlatform } from '@/lib/collections/platforms';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// In-memory onboarding record. Stubbing the storage module (rather than
// wxt/utils/storage) also keeps the lib/storage barrel — and its provider
// imports — out of this test.
const written: unknown[] = [];
let writeFails = false;

vi.mock('@/lib/storage', () => ({
  onboardingStorage: {
    async setValue(value: unknown) {
      if (writeFails) throw new Error('quota');
      written.push(value);
    },
  },
}));

import { useOnboardingExit } from './use-onboarding-exit';

type Exit = (picked?: CollectionPlatform[]) => Promise<void>;

function renderHook(container: HTMLElement) {
  let exit: Exit = async () => {};
  let leaving = false;

  function Probe() {
    const hook = useOnboardingExit();
    exit = hook.exit;
    leaving = hook.leaving;
    return null;
  }

  const root = createRoot(container);
  act(() => root.render(<Probe />));

  return { root, run: (picked?: CollectionPlatform[]) => exit(picked), isLeaving: () => leaving };
}

let container: HTMLElement;
let root: Root | undefined;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  written.length = 0;
  writeFails = false;
  replace = vi.fn();

  vi.stubGlobal('browser', {
    runtime: { getURL: (path: string) => `chrome-extension://fake${path}` },
  });
  // happy-dom's Location would actually try to navigate; shadow the method.
  Object.defineProperty(window.location, 'replace', { value: replace, configurable: true });

  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.unstubAllGlobals();
});

describe('useOnboardingExit', () => {
  it('records the picks in registry order before navigating', async () => {
    const hook = renderHook(container);
    root = hook.root;

    await act(() => hook.run(['youtube', 'bilibili']));

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ platforms: ['bilibili', 'youtube'] });
    expect((written[0] as { completedAt: number }).completedAt).toBeGreaterThan(0);
  });

  it('lands on the first ready platform collection page', async () => {
    const hook = renderHook(container);
    root = hook.root;

    await act(() => hook.run(['bookmarks']));

    expect(replace).toHaveBeenCalledWith(
      'chrome-extension://fake/app.html#/collections/bookmarks'
    );
  });

  it('lands on settings when the first pick needs a credential', async () => {
    const hook = renderHook(container);
    root = hook.root;

    await act(() => hook.run(['github']));

    expect(replace).toHaveBeenCalledWith('chrome-extension://fake/app.html#/settings');
  });

  // Empty picker submission still writes, so the install-time tab stays gone.
  it('still records a completion when nothing was picked', async () => {
    const hook = renderHook(container);
    root = hook.root;

    await act(() => hook.run([]));

    expect(written[0]).toMatchObject({ platforms: [] });
    expect(replace).toHaveBeenCalledWith('chrome-extension://fake/app.html');
  });

  // A failed write costs one extra welcome screen; being stuck on this page
  // would cost the whole install.
  it('navigates anyway when the record cannot be written', async () => {
    writeFails = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const hook = renderHook(container);
    root = hook.root;

    await act(() => hook.run(['zhihu']));

    expect(replace).toHaveBeenCalledWith(
      'chrome-extension://fake/app.html#/collections/zhihu'
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('flips leaving so the CTA can block a double click', async () => {
    const hook = renderHook(container);
    root = hook.root;

    expect(hook.isLeaving()).toBe(false);
    await act(() => hook.run(['x']));
    expect(hook.isLeaving()).toBe(true);
  });
});
