import type { Variants, Transition } from 'motion/react';

type Options = {
  transitionIn?: Transition;
  transitionOut?: Transition;
};

/**
 * Stagger owner. A parent carrying these variants sequences its children
 * automatically, so a homogeneous list (the six picker cards, the checkmark
 * bullets) never hand-computes per-item delays. Bands with a *deliberate*
 * rhythm — the hero's 0.1/0.2/0.34/0.46 ladder, the showcase scripts — keep
 * their explicit `FadeIn delay`, because a fixed 50 ms step would flatten them
 * into "everything at once".
 */
export const varContainer = (props?: Options): Variants => ({
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.05,
      ...props?.transitionIn,
    },
  },
  exit: {
    transition: {
      staggerChildren: 0.05,
      staggerDirection: -1,
      ...props?.transitionOut,
    },
  },
});
