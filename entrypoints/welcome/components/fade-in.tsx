import type { ReactNode } from 'react';
import type { MotionSafeBoxProps } from './motion-box';

import { MotionBox } from './motion-box';
import { transitionEnter } from './animate';

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
 *
 * The easing and default duration come from `animate/variants/transition`, the
 * same source `varFade` uses, so the two animation paths on this page cannot
 * drift apart. `x`/`y` stay free-form here on purpose: `varFade` takes a fixed
 * direction plus one distance, which cannot express "up and to the left", and
 * bolting an (x, y) -> direction mapping onto it would be more code than the
 * two inline objects below.
 *
 * Use this for bands with a deliberate rhythm. For homogeneous lists, wrap the
 * parent in `MotionContainer` and let `varContainer` sequence the children.
 */
export function FadeIn({ delay = 0, duration, x = 0, y = 24, children, ...other }: FadeInProps) {
  return (
    <MotionBox
      initial={{ opacity: 0, x, y }}
      whileInView={{ opacity: 1, x: 0, y: 0 }}
      viewport={{ once: true, margin: '-48px' }}
      transition={transitionEnter({ delay, ...(duration !== undefined && { duration }) })}
      {...other}
    >
      {children}
    </MotionBox>
  );
}
