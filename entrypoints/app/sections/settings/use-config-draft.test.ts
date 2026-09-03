import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/lib/i18n', () => ({ t: (key: string) => key }));

vi.mock('../../components/snackbar', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

import { computeDraftGate, connectionSignature, useConfigDraft } from './use-config-draft';

import type { ConfigDraftState } from './use-config-draft';

interface Draft {
  provider: string;
  apiKey: string;
  model: string;
  temperature: number;
  [key: string]: unknown;
}

const CONN_KEYS = ['provider', 'apiKey'] as const satisfies readonly (keyof Draft)[];

const saved: Draft = { provider: 'groq', apiKey: 'k1', model: 'whisper', temperature: 0.3 };

describe('connectionSignature', () => {
  it('is stable for equal connection fields regardless of other fields', () => {
    const a = { ...saved, model: 'x' };
    const b = { ...saved, model: 'y' };
    expect(connectionSignature(a, CONN_KEYS)).toBe(connectionSignature(b, CONN_KEYS));
  });

  it('differs when a connection field changes', () => {
    const edited = { ...saved, apiKey: 'k2' };
    expect(connectionSignature(edited, CONN_KEYS)).not.toBe(connectionSignature(saved, CONN_KEYS));
  });

  it('maps undefined to a stable serializable value', () => {
    const a = { ...saved, apiKey: undefined as unknown as string };
    expect(() => connectionSignature(a, CONN_KEYS)).not.toThrow();
    expect(connectionSignature(a, CONN_KEYS)).toBe(connectionSignature({ ...a }, CONN_KEYS));
  });
});

describe('computeDraftGate', () => {
  it('pristine draft: nothing to save', () => {
    const gate = computeDraftGate({ ...saved }, saved, CONN_KEYS, null);
    expect(gate.dirty).toBe(false);
    expect(gate.connectionDirty).toBe(false);
    expect(gate.canSave).toBe(false);
  });

  it('pre-existing config (draft equals saved) verified by a test: save allowed to record configSavedAt', () => {
    // Regression: legacy auto-saved / env-default configs start with dirty=false;
    // a successful test must still enable Save (idempotent rewrite + badge timestamp).
    const draft = { ...saved };
    const sig = connectionSignature(draft, CONN_KEYS);
    const gate = computeDraftGate(draft, saved, CONN_KEYS, sig);
    expect(gate.dirty).toBe(false);
    expect(gate.verified).toBe(true);
    expect(gate.canSave).toBe(true);
  });

  it('connection edit without a test: save blocked', () => {
    const draft = { ...saved, apiKey: 'k2' };
    const gate = computeDraftGate(draft, saved, CONN_KEYS, null);
    expect(gate.dirty).toBe(true);
    expect(gate.connectionDirty).toBe(true);
    expect(gate.verified).toBe(false);
    expect(gate.canSave).toBe(false);
  });

  it('connection edit verified by a matching test signature: save allowed', () => {
    const draft = { ...saved, apiKey: 'k2' };
    const sig = connectionSignature(draft, CONN_KEYS);
    const gate = computeDraftGate(draft, saved, CONN_KEYS, sig);
    expect(gate.verified).toBe(true);
    expect(gate.canSave).toBe(true);
  });

  it('editing a connection field after a successful test invalidates it', () => {
    const tested = { ...saved, apiKey: 'k2' };
    const sig = connectionSignature(tested, CONN_KEYS);
    const editedAgain = { ...tested, apiKey: 'k3' };
    const gate = computeDraftGate(editedAgain, saved, CONN_KEYS, sig);
    expect(gate.verified).toBe(false);
    expect(gate.canSave).toBe(false);
  });

  it('non-connection edit: save allowed without any test', () => {
    const draft = { ...saved, temperature: 0.7 };
    const gate = computeDraftGate(draft, saved, CONN_KEYS, null);
    expect(gate.dirty).toBe(true);
    expect(gate.connectionDirty).toBe(false);
    expect(gate.canSave).toBe(true);
  });

  it('provider-only switch counts as a connection edit', () => {
    const draft = { ...saved, provider: 'siliconflow' };
    const gate = computeDraftGate(draft, saved, CONN_KEYS, null);
    expect(gate.connectionDirty).toBe(true);
    expect(gate.canSave).toBe(false);
  });

  it('stale signature from a test that raced a concurrent edit never verifies', () => {
    const staleSig = connectionSignature(saved, CONN_KEYS);
    const draft = { ...saved, apiKey: 'k2' };
    const gate = computeDraftGate(draft, saved, CONN_KEYS, staleSig);
    expect(gate.verified).toBe(false);
    expect(gate.canSave).toBe(false);
  });
});

describe('useConfigDraft save results', () => {
  // The Save button is a bare `onClick`, so the hook — not the card — owns the
  // report (docs/25 Step 5): success and failure both leave through a toast and
  // handleSave never rejects.
  let container: HTMLDivElement;
  let root: Root;

  // Stable identities: `derive` feeds a `[derive]` effect inside the hook, so a
  // fresh closure per render is an infinite re-render, exactly as it would be
  // in a card that forgot to memoize it.
  const derive = () => ({ ...saved });
  const runTest = async () => true;

  function mount(save: (draft: Draft) => Promise<void>): () => ConfigDraftState<Draft, boolean> {
    let latest: ConfigDraftState<Draft, boolean> | null = null;

    function Probe() {
      latest = useConfigDraft<Draft, boolean>({
        derive,
        connectionKeys: CONN_KEYS,
        runTest,
        save,
      });
      return null;
    }

    act(() => root.render(createElement(Probe)));
    return () => {
      if (!latest) throw new Error('Probe never rendered');
      return latest;
    };
  }

  beforeEach(() => {
    mocks.toastSuccess.mockReset();
    mocks.toastError.mockReset();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('raises one success toast and clears the saving flag', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const state = mount(save);

    await act(async () => state().handleSave());

    expect(save).toHaveBeenCalledOnce();
    expect(mocks.toastSuccess).toHaveBeenCalledExactlyOnceWith('snackbar.saved');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(state().isSaving).toBe(false);
  });

  it('swallows a rejected save into one error toast instead of an unhandled rejection', async () => {
    const save = vi.fn().mockRejectedValue(new Error('storage unavailable'));
    const state = mount(save);

    await act(async () => expect(state().handleSave()).resolves.toBeUndefined());

    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('snackbar.saveFailed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(state().isSaving).toBe(false);
  });
});
