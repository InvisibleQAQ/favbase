/**
 * Cross-context pure formatters. Lives at `lib/` root (like `providers.ts`)
 * because every context needs it: app.html cards, the content-script panel, and
 * the prompt builders in `lib/`.
 */

/**
 * Seconds → compact clock string: `m:ss` under an hour, `h:mm:ss` from an hour
 * up. Single source of truth — duration badges (app.html), subtitle timestamps
 * and summary chapter times (content script) and the numbered transcript fed to
 * the LLM (`lib/summary/prompt.ts`) all render the same way.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
