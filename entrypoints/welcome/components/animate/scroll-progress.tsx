import type { Theme, SxProps } from '@mui/material/styles';
import type { PaletteColorKey } from '@/entrypoints/app/theme/core/palette';

import { motion, useScroll, useSpring } from 'motion/react';
import { mergeClasses } from 'minimal-shared/utils';

import { styled, useTheme } from '@mui/material/styles';

import { createClasses } from '@/entrypoints/app/theme/create-classes';

export const scrollProgressClasses = {
  linear: createClasses('scroll__progress__linear'),
};

export type ScrollProgressProps = {
  sx?: SxProps<Theme>;
  className?: string;
  /** Bar thickness in px. */
  size?: number;
  color?: PaletteColorKey | 'inherit';
};

/**
 * Hairline reading indicator for the page's own scroll.
 *
 * Ported from Minimal `components/animate/scroll-progress`, reduced to the one
 * shape this page uses: the `circular` variant, the `portal` escape hatch, the
 * RTL mirror (this app ships no `direction` support — docs/25 Step 2 dropped
 * Minimal's direction data layer) and the caller-supplied `progress` prop are
 * all gone. There is one progress source here, the document, so the component
 * reads it itself instead of making every caller wire up a hook.
 *
 * Positioning is the caller's: this paints a bar pinned to the top of its
 * containing block and nothing else.
 */
export function ScrollProgress({
  sx,
  className,
  size = 3,
  color = 'primary',
}: ScrollProgressProps) {
  const theme = useTheme();
  const { scrollYProgress } = useScroll();

  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <LinearRoot
      aria-hidden
      className={mergeClasses([scrollProgressClasses.linear, className])}
      style={{ scaleX }}
      sx={[
        {
          height: size,
          ...(color !== 'inherit' && {
            background: `linear-gradient(135deg, ${theme.vars.palette[color].light}, ${theme.vars.palette[color].main})`,
          }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}

const LinearRoot = styled(motion.div)(({ theme }) => ({
  top: 0,
  left: 0,
  right: 0,
  transformOrigin: '0%',
  backgroundColor: theme.vars.palette.text.primary,
}));
