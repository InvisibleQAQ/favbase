import type { MotionValue } from 'motion/react';
import type { BoxProps } from '@mui/material/Box';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';

import Box from '@mui/material/Box';

const DIM = 0.18;

function Char({
  char,
  progress,
  start,
  end,
}: {
  char: string;
  progress: MotionValue<number>;
  start: number;
  end: number;
}) {
  const opacity = useTransform(progress, [start, end], [DIM, 1]);
  return <motion.span style={{ opacity }}>{char}</motion.span>;
}

/**
 * Paragraph that lights up character by character as it scrolls through the
 * viewport. Words are wrapped in inline-blocks so a Latin word never breaks
 * mid-glyph; CJK has no spaces, so its single "word" fills the line and wraps
 * naturally between characters.
 */
export function AnimatedText({ text, sx }: { text: string; sx?: BoxProps['sx'] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.85', 'end 0.45'],
  });

  // Split on whitespace but keep the separators, so spacing survives verbatim.
  const tokens = text.split(/(\s+)/).filter(Boolean);
  const total = [...text].length;
  let cursor = 0;

  return (
    <Box
      ref={ref}
      component="p"
      sx={[
        { m: 0, textWrap: 'pretty' },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {tokens.map((token, tokenIndex) => {
        const chars = [...token];
        const offset = cursor;
        cursor += chars.length;

        // Whitespace has nothing to reveal — render it as a plain break point.
        if (/^\s+$/.test(token)) return token;

        return (
          <Box key={tokenIndex} component="span" sx={{ display: 'inline-block' }}>
            {chars.map((char, i) => (
              <Char
                key={i}
                char={char}
                progress={scrollYProgress}
                start={(offset + i) / total}
                end={(offset + i + 1) / total}
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
