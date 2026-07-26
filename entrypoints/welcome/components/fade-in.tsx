import type { ReactNode } from 'react';
import type { MotionSafeBoxProps } from './motion-box';

import { MotionBox } from './motion-box';

/** House easing for the whole page — a gentle in-out with a long tail. */
export const WELCOME_EASE = [0.25, 0.1, 0.25, 1] as const;

export type FadeInProps = MotionSafeBoxProps & {
  /** Seconds to wait before starting — the stagger knob. */
  delay?: number;
  duration?: number;
  /** Travel distance in px; the element animates from (x, y) to (0, 0). */
  x?: number;
  y?: number;
  children?: ReactNode;
};

/**
 * Reveal-on-scroll wrapper. Fires once when the element enters the viewport and
 * stays put afterwards — no re-triggering on the way back up, which reads as
 * flicker on a page this long.
 */
export function FadeIn({
  delay = 0,
  duration = 0.7,
  x = 0,
  y = 24,
  children,
  ...other
}: FadeInProps) {
  return (
    <MotionBox
      initial={{ opacity: 0, x, y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '-48px' }}
      transition={{ delay, duration, ease: WELCOME_EASE }}
      {...other}
    >
      {children}
    </MotionBox>
  );
}
