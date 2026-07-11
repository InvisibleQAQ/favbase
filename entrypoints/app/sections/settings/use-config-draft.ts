import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Pure gate logic (unit-testable without React)
// ---------------------------------------------------------------------------

/**
 * Serializes the connection-relevant subset of a draft. Two drafts with the
 * same signature are interchangeable as far as a connection test is
 * concerned — the signature a successful test was run against stays valid
 * until one of these fields changes.
 */
export function connectionSignature<T extends object>(
  draft: T,
  connectionKeys: readonly (keyof T)[],
): string {
  return JSON.stringify(connectionKeys.map((k) => draft[k] ?? null));
}

export interface DraftGate {
  /** Draft differs from the saved active config (anything to save at all). */
  dirty: boolean;
  /** Connection-relevant fields differ from the saved active config. */
  connectionDirty: boolean;
  /** A connection test succeeded against the draft's current connection values. */
  verified: boolean;
  /** Save allowed: verified always saves (even if equal to storage — idempotent rewrite records configSavedAt); otherwise only a non-connection change. */
  canSave: boolean;
}

export function computeDraftGate<T extends object>(
  draft: T,
  savedActive: T,
  connectionKeys: readonly (keyof T)[],
  verifiedSig: string | null,
): DraftGate {
  const keys = Object.keys(draft) as (keyof T)[];
  const dirty = keys.some((k) => draft[k] !== savedActive[k]);
  const connSig = connectionSignature(draft, connectionKeys);
  const connectionDirty = connSig !== connectionSignature(savedActive, connectionKeys);
  const verified = verifiedSig !== null && verifiedSig === connSig;
  return { dirty, connectionDirty, verified, canSave: verified || (dirty && !connectionDirty) };
}

// ---------------------------------------------------------------------------
// useConfigDraft
// ---------------------------------------------------------------------------

export interface ConfigDraftState<T extends { provider: string }, R> extends DraftGate {
  draft: T;
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Reloads the draft with the given provider's saved values. */
  switchProvider: (provider: T['provider']) => void;
  /** Runs `runTest(draft)`; an accepted result verifies the signature captured at test start. */
  handleTest: () => Promise<void>;
  isTesting: boolean;
  /** Last test result — cleared when a connection field changes. */
  testResult: R | null;
  /** Last test failure message — cleared when a connection field changes. */
  testError: string | null;
  /** Runs `save(draft)`; on success resets touched (external syncs resume) and clears the verified signature (Save returns to disabled, success Alert yields to the persistent badge). */
  handleSave: () => Promise<void>;
  isSaving: boolean;
}

const acceptAlways = () => true;

/**
 * Local draft for a settings card: edits never touch storage; `derive` maps
 * stored settings to the flat draft shape (`derive()` = the saved active
 * config, `derive(p)` = provider p's saved values for provider switching).
 * The test→verify→save state machine lives here; cards only supply the
 * card-specific probe (`runTest`) and persistence (`save`).
 */
export function useConfigDraft<T extends { provider: string }, R>(options: {
  derive: (provider?: T['provider']) => T;
  connectionKeys: readonly (keyof T)[];
  /** Card-specific connection probe; thrown errors surface as `testError`. */
  runTest: (draft: T) => Promise<R>;
  /** Result gate: only an accepted result verifies (default: always accept). */
  acceptResult?: (result: R) => boolean;
  save: (draft: T) => Promise<void>;
}): ConfigDraftState<T, R> {
  const { derive, connectionKeys, runTest, acceptResult = acceptAlways, save } = options;
  const [draft, setDraft] = useState<T>(() => derive());
  const [verifiedSig, setVerifiedSig] = useState<string | null>(null);
  const touchedRef = useRef(false);

  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<R | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Adopt external changes (initial storage load, saves from other contexts)
  // only while the user hasn't edited — never clobber an in-progress draft.
  useEffect(() => {
    if (!touchedRef.current) setDraft(derive());
  }, [derive]);

  const setField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setDraft((prev) => {
      // No-op guard: MUI Autocomplete fires onInputChange('reset') on mount
      // with the unchanged value; that must not mark the draft as touched.
      if (prev[field] === value) return prev;
      touchedRef.current = true;
      return { ...prev, [field]: value };
    });
  }, []);

  const switchProvider = useCallback(
    (provider: T['provider']) => {
      touchedRef.current = true;
      setDraft(derive(provider));
    },
    [derive],
  );

  const connSig = connectionSignature(draft, connectionKeys);

  // Stale test feedback never survives a connection-field edit: the verified
  // gate already follows the signature; the visible Alerts must follow too.
  const prevConnSigRef = useRef(connSig);
  useEffect(() => {
    if (prevConnSigRef.current !== connSig) {
      prevConnSigRef.current = connSig;
      setTestResult(null);
      setTestError(null);
    }
  }, [connSig]);

  const handleTest = useCallback(async () => {
    setIsTesting(true);
    setTestResult(null);
    setTestError(null);
    // Captured before the await: if the user edits a connection field while
    // the test is in flight, this stale signature never verifies the new draft.
    const testedSig = connSig;

    try {
      const result = await runTest(draft);
      setTestResult(result);
      if (acceptResult(result)) setVerifiedSig(testedSig);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  }, [connSig, draft, runTest, acceptResult]);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      await save(draft);
      // Reset touched (external syncs resume) and clear the verified signature
      // (Save returns to disabled, the success Alert yields to the saved badge).
      touchedRef.current = false;
      setVerifiedSig(null);
    } finally {
      setIsSaving(false);
    }
  }, [save, draft]);

  const gate = computeDraftGate(draft, derive(), connectionKeys, verifiedSig);

  return {
    draft,
    setField,
    switchProvider,
    handleTest,
    isTesting,
    testResult,
    testError,
    handleSave,
    isSaving,
    ...gate,
  };
}
