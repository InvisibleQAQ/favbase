import { flushSync } from 'react-dom';

export type ColorModeValue = 'light' | 'dark' | 'system';

/**
 * Swap the color mode with a circular reveal growing from `origin` (View
 * Transitions API, Chromium-only).
 *
 * `flushSync` forces MUI to commit `data-color-scheme` *inside* the transition
 * callback, otherwise the "after" snapshot is still the old theme. Falls back to
 * an instant swap when the API is missing or the user asked for reduced motion.
 * The companion `::view-transition-*(root)` rules live in `app/global.css`.
 *
 * Moved out of the deleted `layouts/dashboard/header-actions.tsx` in docs/25
 * Step 4: the appearance drawer's Mode options and the welcome top bar's switch
 * both need it. `ThemeProvider` keeps `disableTransitionOnChange` so the
 * snapshot swap is not fighting per-element CSS transitions.
 */
export function setModeWithReveal(
  setMode: (mode: ColorModeValue) => void,
  next: ColorModeValue,
  origin: { x: number; y: number },
): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!document.startViewTransition || reduceMotion) {
    setMode(next);
    return;
  }

  const { x, y } = origin;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = document.startViewTransition(() => flushSync(() => setMode(next)));

  transition.ready
    .then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${endRadius}px at ${x}px ${y}px)`] },
        { duration: 420, easing: 'ease-in-out', pseudoElement: '::view-transition-new(root)' },
      );
    })
    // A transition the browser skips (another one started, tab hidden) rejects
    // `ready`; the mode already changed, so there is nothing to recover.
    .catch(() => undefined);
}

/** Center of the element that triggered the swap — the reveal grows from there. */
export function revealOriginFrom(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
