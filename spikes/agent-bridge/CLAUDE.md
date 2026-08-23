# Agent Bridge Phase 0 spike

This directory owns the disposable runtime evidence for
`docs/21_agent-bridge-analysis-2026-08-22.md` Phase 0. It is not a production
Agent Bridge implementation.

## Files

- `background-spike.ts` runs only when `VITE_AGENT_BRIDGE_SPIKE=1`. It
  proves the real Background SW can create the Offscreen document, obtain a DB
  proxy, run `hybridRetrieve`, convert all three Knowledge Tool input schemas
  with `z.toJSONSchema`, and invoke `searchKnowledgeBase.execute` with the
  real DB context.
- `ws-peer.py` listens only on `127.0.0.1`, sends an application-level ping
  every 20 seconds, records pongs and the SW instance identity, and emits the
  machine-readable verdict.
- `run-phase-0.ps1` builds the extension, copies the build to a temporary
  directory, removes `<all_urls>` and loopback host patterns from only that
  derived manifest, launches an isolated Chrome profile, loads the extension
  through Chrome DevTools, and cleans up its own processes and temporary
  directory. Branded Chrome 137+ ignores `--load-extension`, so the runner
  deliberately uses `Extensions.loadUnpacked` with
  `--enable-unsafe-extension-debugging`.
- `load-extension.mjs` is the narrow Chrome DevTools client used by the
  PowerShell runner; it sends only `Extensions.loadUnpacked`.
- `phase-0-result.json` is generated evidence. It contains timing, counts,
  schema names, the extension origin, and permissions; it must never contain
  Collection Item text or credentials.

## Run

```powershell
powershell -ExecutionPolicy Bypass -File .\spikes\agent-bridge\run-phase-0.ps1
```

The default observation window is 330 seconds, so the first-to-last 20-second
heartbeat span exceeds five minutes. A failure in any required check exits
non-zero and is a Phase 0 NO-GO.
