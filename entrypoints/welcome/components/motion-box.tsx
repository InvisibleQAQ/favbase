import type { ComponentType } from 'react';
import type { BoxProps } from '@mui/material/Box';
import type { ButtonBaseProps } from '@mui/material/ButtonBase';

import { motion } from 'motion/react';

import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';

/**
 * React's DOM drag/animation handler types collide with motion's props of the
 * same name, so they are dropped from the MUI side: on these elements motion's
 * `onDrag`/`onAnimationStart` semantics are the ones we mean. Declared once
 * here so every section imports the same animated primitives.
 */
type MotionSafe<P> = Omit<
  P,
  'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onAnimationEnd' | 'style'
>;

/** `BoxProps` minus the handlers motion claims — what MotionBox actually takes. */
export type MotionSafeBoxProps = MotionSafe<BoxProps>;

export const MotionBox = motion.create(Box as ComponentType<MotionSafeBoxProps>);

export const MotionButtonBase = motion.create(
  ButtonBase as ComponentType<MotionSafe<ButtonBaseProps>>
);
