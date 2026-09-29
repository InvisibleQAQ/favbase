import type { ComponentProps } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';

import { motion } from 'motion/react';

import { styled } from '@mui/material/styles';

import { MotionBox } from './motion-box';
import { transitionEnter } from './animate';

/**
 * The section decorations of Minimal's home page: a dashed grey spine in the
 * left gutter, run on from band to band, with a small mark at the head of each
 * band. Ported from Minimal `sections/home/components/svg-elements.tsx` for
 * docs/31 Step 4 (user decision 2026-09-28: follow each Minimal section file).
 *
 * Every value is Minimal's. What changed:
 * - `framer-motion` -> `motion/react`, `m.*` -> `motion.*` (no `LazyMotion`,
 *   docs/28 §3.2); `Box component={m.span}` -> `MotionBox component="span"`.
 * - Minimal's module-level `transition` is `{ duration: 0.64, ease: [0.43,
 *   0.13, 0.23, 0.96] }`, value for value `transitionEnter()`, so the variants
 *   call that instead of declaring the curve a second time (docs/28 E1).
 * - Each root carries `aria-hidden`: pure decoration, nothing to announce.
 *   It sits before `{...other}`, so it is a default and not a lock.
 *
 * Nothing here animates on its own. The marks and lines only carry
 * `initial`/`animate` variants; `MotionViewport` (`animate/motion-viewport`)
 * sets those labels when its band scrolls into view and motion propagates them
 * down the variant tree. A band that wants lines renders them inside a
 * `MotionViewport` (`WelcomeSection lines` does it for you) — do not give a
 * line a `whileInView` of its own.
 *
 * Every element is `display: none` below 1440px, exactly as in Minimal; at
 * 1440 the Container's gutter is wide enough for `left: 80` to clear content.
 *
 * Not ported (docs/28 §3.4 precedent: no consumer, no port):
 * - `FloatXIcon`: only Minimal's pricing band uses it, and nothing here maps
 *   to that band.
 * - `CircleSvg`: it is not behind the 1440 gate (shows from `md`) and sits
 *   centred in the Container, between Minimal's text column and a bare image.
 *   In favbase's bands that spot is body copy on one side and an opaque demo
 *   card on the other. docs/28 D5's reason (concentric dashes against the
 *   hero's `OrbitCore`) does not apply to bands without an orbit — the reason
 *   is placement, not that one.
 */

const baseStyles = (theme: Theme): SxProps<Theme> => ({
  zIndex: 2,
  display: 'none',
  color: 'grey.500',
  position: 'absolute',
  '& line': { strokeDasharray: 3, stroke: 'currentColor' },
  '& path': { fill: 'currentColor', stroke: 'currentColor' },
  [theme.breakpoints.up(1440)]: { display: 'block' },
});

type SvgRootProps = ComponentProps<typeof SvgRoot>;

const SvgRoot = styled(motion.svg)``;

export function FloatLine({ sx, vertical, ...other }: SvgRootProps & { vertical?: boolean }) {
  return (
    <SvgRoot
      aria-hidden
      sx={[
        (theme) => ({
          ...baseStyles(theme),
          width: 1,
          zIndex: 1,
          height: '1px',
          opacity: 0.24,
          ...(vertical && { width: '1px', height: 1 }),
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      {vertical ? (
        <motion.line
          x1="0.5"
          x2="0.5"
          y1="0"
          y2="100%"
          variants={{
            initial: { y2: '0%' },
            animate: { y2: '100%', transition: transitionEnter() },
          }}
        />
      ) : (
        <motion.line
          x1="0"
          x2="100%"
          y1="0.5"
          y2="0.5"
          variants={{
            initial: { x2: '0%' },
            animate: { x2: '100%', transition: transitionEnter() },
          }}
        />
      )}
    </SvgRoot>
  );
}

export function FloatPlusIcon({ sx, ...other }: SvgRootProps) {
  return (
    <SvgRoot
      aria-hidden
      variants={{
        initial: { scale: 0 },
        animate: { scale: 1, transition: transitionEnter() },
      }}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      sx={[
        (theme) => ({
          ...baseStyles(theme),
          width: 16,
          height: 16,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <path d="M8 0V16M16 8.08889H0" />
    </SvgRoot>
  );
}

export function FloatTriangleLeftIcon({ sx, ...other }: SvgRootProps) {
  return (
    <SvgRoot
      aria-hidden
      variants={{
        initial: { scaleY: 0 },
        animate: { scaleY: 1, transition: transitionEnter() },
      }}
      width="10"
      height="20"
      viewBox="0 0 10 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      sx={[
        (theme) => ({
          ...baseStyles(theme),
          width: 10,
          height: 20,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <path d="M10 10L8.74228e-07 20L0 0L10 10Z" />
    </SvgRoot>
  );
}

export function FloatTriangleDownIcon({ sx, ...other }: SvgRootProps) {
  return (
    <SvgRoot
      aria-hidden
      variants={{
        initial: { scaleX: 0 },
        animate: { scaleX: 1, transition: transitionEnter() },
      }}
      width="20"
      height="10"
      viewBox="0 0 20 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      sx={[
        (theme) => ({
          ...baseStyles(theme),
          width: 20,
          height: 10,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <path d="M10 10L0 0H20L10 10Z" />
    </SvgRoot>
  );
}

/**
 * A filled dot, the one mark that is a `span` rather than an `svg`. Minimal
 * types it `BoxProps<'span'> & MotionProps` over `Box component={m.span}`; here
 * it is `MotionBox` rendering a span, typed by what `MotionBox` accepts.
 */
export function FloatDotIcon({ sx, ...other }: ComponentProps<typeof MotionBox>) {
  return (
    <MotionBox
      component="span"
      aria-hidden
      variants={{
        initial: { scale: 0 },
        animate: { scale: 1, transition: transitionEnter() },
      }}
      sx={[
        (theme) => ({
          ...baseStyles(theme),
          width: 12,
          height: 12,
          borderRadius: '50%',
          bgcolor: 'currentColor',
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}
