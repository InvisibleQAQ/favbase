import type { ComponentProps } from 'react';

import { MotionBox } from '../motion-box';
import { varContainer } from './variants';

export type MotionViewportProps = ComponentProps<typeof MotionBox>;

/**
 * Stagger parent that plays once its band is 30% in view: it sets the
 * `initial` label on mount and `animate` on entry, and motion hands both down
 * the variant tree. Ported from Minimal `motion-viewport` for docs/31 Step 4.
 *
 * Only descendants that carry `variants` are driven by it. On this page that is
 * the section decoration in `components/svg-elements` and the two-triangle
 * mark under the product tour's title, nothing else:
 * `FadeIn` passes objects to `initial`/`whileInView`, not variant labels, so it
 * keeps its own observer and its own timing (docs/28 D6), inside a
 * `MotionViewport` or not.
 *
 * Minimal's `disableAnimate` prop and its `useMediaQuery(smDown)` branch are
 * deleted. Below 600px that branch rendered a plain `div` instead of `m.div`;
 * React treats the swap as a different element type, so crossing the
 * breakpoint unmounts and remounts the whole band — the picker would lose its
 * selection and the chat demo would replay. And it would buy nothing here: the
 * lines it drives are hidden below 1440px anyway.
 *
 * Renders a plain static block (`varContainer` animates no values of its own),
 * so it is not a containing block: an absolutely positioned line inside it is
 * placed against the enclosing `position: relative` section.
 */
export function MotionViewport({ children, viewport, ...other }: MotionViewportProps) {
  return (
    <MotionBox
      initial="initial"
      whileInView="animate"
      variants={varContainer()}
      viewport={{ once: true, amount: 0.3, ...viewport }}
      {...other}
    >
      {children}
    </MotionBox>
  );
}
