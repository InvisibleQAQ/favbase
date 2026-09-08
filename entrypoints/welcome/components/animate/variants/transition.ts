import type { Transition } from 'motion/react';

/**
 * House easing for the whole page — ported from Minimal `variants/transition`.
 * Enter is slower than exit on purpose: content arriving deserves to be
 * noticed, content leaving does not.
 */
export const transitionEnter = (props?: Transition): Transition => ({
  duration: 0.64,
  ease: [0.43, 0.13, 0.23, 0.96],
  ...props,
});

export const transitionExit = (props?: Transition): Transition => ({
  duration: 0.48,
  ease: [0.43, 0.13, 0.23, 0.96],
  ...props,
});
