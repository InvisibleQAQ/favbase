import type { ReactNode } from 'react';
import type { BoxProps } from '@mui/material/Box';

import { useEffect, useRef } from 'react';
import { useReducedMotion, useSpring } from 'motion/react';

import { MotionBox } from './motion-box';

export type MagnetProps = {
  /** Extra px around the element's box that still counts as "near". */
  padding?: number;
  /** Divisor on the cursor offset — higher means a subtler pull. */
  strength?: number;
  children: ReactNode;
  sx?: BoxProps['sx'];
};

/** Same feel as the old `animate` transition, now owned by the springs. */
const SPRING = { stiffness: 110, damping: 15, mass: 0.5 };

/**
 * Magnetic pointer-follow. While the cursor is within `padding` of the box, the
 * content leans toward it and springs back on exit. Skipped entirely under
 * reduced-motion — there is no non-animated version of "follows your mouse"
 * worth shipping.
 *
 * The offset lives in spring MotionValues rather than React state: pointermove
 * fires up to once per frame, and a state write would re-render everything
 * wrapped by this component on every one of them (the hero orbit alone is ~20
 * motion nodes). MotionValues drive the transform outside the React tree.
 */
export function Magnet({ padding = 140, strength = 5, children, sx }: MagnetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const nearRef = useRef(false);
  const x = useSpring(0, SPRING);
  const y = useSpring(0, SPRING);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;

    const handleMove = (event: PointerEvent) => {
      const el = ref.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = event.clientX - cx;
      const dy = event.clientY - cy;
      const near =
        Math.abs(dx) < rect.width / 2 + padding && Math.abs(dy) < rect.height / 2 + padding;

      if (near) {
        nearRef.current = true;
        x.set(dx / strength);
        y.set(dy / strength);
      } else if (nearRef.current) {
        // Only on the frame the cursor leaves, so an idle pointer elsewhere on
        // the page never re-targets a spring that is already home.
        nearRef.current = false;
        x.set(0);
        y.set(0);
      }
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    return () => window.removeEventListener('pointermove', handleMove);
  }, [padding, strength, reduceMotion, x, y]);

  return (
    <MotionBox ref={ref} style={{ x, y }} sx={sx}>
      {children}
    </MotionBox>
  );
}
