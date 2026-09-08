import type { ReactNode } from 'react';
import type { MotionSafeBoxProps } from '../motion-box';

import { MotionBox } from '../motion-box';
import { varContainer } from './variants';

export type MotionContainerProps = MotionSafeBoxProps & {
  children?: ReactNode;
};

/**
 * Stagger parent for content that plays on mount rather than on scroll — the
 * hero's first screen. Children only declare `variants={varFade(...)}`; the
 * sequencing comes from `varContainer`.
 *
 * Ported from Minimal `motion-container`, minus its `action`/`animate` pair:
 * that toggle drives Minimal's dialog/menu entrances, and welcome has no
 * caller that flips a container between animate and exit.
 *
 * Uses `MotionBox` rather than `Box component={motion.div}` so this page keeps
 * one definition of "an animated Box" (see `components/motion-box.tsx`).
 */
export function MotionContainer({ children, ...other }: MotionContainerProps) {
  return (
    <MotionBox variants={varContainer()} initial="initial" animate="animate" exit="exit" {...other}>
      {children}
    </MotionBox>
  );
}
