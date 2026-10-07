# Agent Bridge Phase 0 spike

Disposable runtime evidence for `docs/21_agent-bridge-analysis-2026-08-22.md` Phase 0. It is not
a production Agent Bridge implementation (that is `lib/agent-bridge/` + `packages/favbase/`): do
not import from it or build on it.

- `background-spike.ts` loads only in a build made with `VITE_AGENT_BRIDGE_SPIKE=1`
  (`entrypoints/background.ts`).
- `phase-0-result.json` is the generated evidence of the Phase 0 run. It must never contain
  Collection Item text or credentials. Its key `jsonSchemaThreeTools` is the old name (three
  tools existed then); `ws-peer.py` now writes `jsonSchemaAllTools` and pins no tool count.
- Branded Chrome 137+ ignores `--load-extension`, so the runner loads the build through DevTools
  `Extensions.loadUnpacked` with `--enable-unsafe-extension-debugging`.
- The runner strips `<all_urls>` and loopback host patterns from a temporary copy of the built
  manifest only. That is the point of the check (an outbound loopback WebSocket needs no host
  permission); never strip them from the real manifest.
- `[UNKNOWN]` whether it still runs: the spike is loaded through a dynamic `import()` in the
  Service Worker, and the runner calls `pnpm build`, whose bundle check
  (`scripts/check-background-bundle.mjs`) rejects those. That check is newer than the recorded
  run, and the spike has not been rerun since.

Run it (330 s by default, so the 20 s heartbeat spans more than five minutes; any failed check
exits non-zero and is a Phase 0 NO-GO):

```powershell
powershell -ExecutionPolicy Bypass -File .\spikes\agent-bridge\run-phase-0.ps1
```
