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

export interface ConfigDraftState<T extends { provider: string }> extends DraftGate {
  draft: T;
  setField: <K extends keyof T>(field: K, value: T[K]) => void;
  /** Reloads the draft with the given provider's saved values. */
  switchProvider: (provider: T['provider']) => void;
  /** Signature of the draft's current connection fields — capture it before an async test starts. */
  connSig: string;
  /** Record a successful test against the signature captured at test start. */
  markVerified: (sig: string) => void;
  /** After a successful save: reset touched (external syncs resume) and clear the verified signature (Save returns to disabled, success Alert yields to the persistent badge). */
  markSaved: () => void;
}

/**
 * Local draft for a settings card: edits never touch storage; `derive` maps
 * stored settings to the flat draft shape (`derive()` = the saved active
 * config, `derive(p)` = provider p's saved values for provider switching).
 */
export function useConfigDraft<T extends { provider: string }>(options: {
  derive: (provider?: T['provider']) => T;
  connectionKeys: readonly (keyof T)[];
}): ConfigDraftState<T> {
  const { derive, connectionKeys } = options;
  const [draft, setDraft] = useState<T>(() => derive());
  const [verifiedSig, setVerifiedSig] = useState<string | null>(null);
  const touchedRef = useRef(false);

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

  const markVerified = useCallback((sig: string) => setVerifiedSig(sig), []);
  const markSaved = useCallback(() => {
    touchedRef.current = false;
    setVerifiedSig(null);
  }, []);

  const gate = computeDraftGate(draft, derive(), connectionKeys, verifiedSig);
  const connSig = connectionSignature(draft, connectionKeys);

  return { draft, setField, switchProvider, connSig, markVerified, markSaved, ...gate };
}
