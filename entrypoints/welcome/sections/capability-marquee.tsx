import type { LocaleKeys } from '@/lib/i18n';
import type { IconifyName } from '@/entrypoints/app/components/iconify';

import { useRef } from 'react';
import { useReducedMotion, useScroll, useTransform } from 'motion/react';

import Box from '@mui/material/Box';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';

import { MotionBox } from '../components/motion-box';

type Pill = { labelKey: LocaleKeys; icon?: IconifyName };

/** Platforms lead the top row; the capabilities they unlock trail the bottom. */
const ROW_TOP: Pill[] = [
  { labelKey: 'nav.bilibiliFavorites', icon: 'simple-icons:bilibili' },
  { labelKey: 'welcome.tags.semanticSearch' },
  { labelKey: 'nav.githubStars', icon: 'mdi:github' },
  { labelKey: 'welcome.tags.localFirst' },
  { labelKey: 'nav.bookmarks', icon: 'solar:bookmark-bold-duotone' },
  { labelKey: 'welcome.tags.aiTags' },
  { labelKey: 'nav.xBookmarks', icon: 'mdi:twitter' },
];

const ROW_BOTTOM: Pill[] = [
  { labelKey: 'welcome.tags.hybridRetrieval' },
  { labelKey: 'nav.zhihuFavorites', icon: 'simple-icons:zhihu' },
  { labelKey: 'welcome.tags.transcription' },
  { labelKey: 'nav.youtubePlaylists', icon: 'mdi:youtube' },
  { labelKey: 'welcome.tags.summary' },
  { labelKey: 'welcome.tags.pglite' },
  { labelKey: 'welcome.tags.obsidian' },
  { labelKey: 'welcome.tags.incremental' },
  { labelKey: 'welcome.tags.noServer' },
];

function PillRow({ pills }: { pills: Pill[] }) {
  const { t } = useTranslation();

  return (
    <Box sx={{ display: 'flex', gap: 1.5, width: 'max-content' }}>
      {/* Tripled so the row still covers the viewport at either scroll extreme. */}
      {[0, 1, 2].map((copy) =>
        pills.map((pill) => (
          <Box
            key={`${copy}-${pill.labelKey}`}
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
              px: 2.25,
              py: 1.25,
              borderRadius: 999,
              fontSize: { xs: 14, md: 15 },
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: 'text.primary',
              bgcolor: 'background.paper',
              border: `1px solid ${theme.vars.palette.divider}`,
              boxShadow: theme.vars.customShadows.z1,
            })}
          >
            {pill.icon ? (
              <Iconify icon={pill.icon} width={18} />
            ) : (
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />
            )}
            {t(pill.labelKey)}
          </Box>
        ))
      )}
    </Box>
  );
}

/**
 * Two counter-scrolling pill rows, driven by the page scroll rather than a CSS
 * loop — the movement stops when the reader stops, which keeps it from
 * competing with the copy for attention.
 */
export function CapabilityMarquee() {
  const ref = useRef<HTMLDivElement>(null);
  // MotionConfig's reducedMotion only governs declarative `animate` props —
  // style-bound MotionValues bypass it, so the parallax is gated by hand.
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });

  const topX = useTransform(scrollYProgress, [0, 1], ['-4%', '-26%']);
  const bottomX = useTransform(scrollYProgress, [0, 1], ['-26%', '-4%']);

  return (
    <Box
      ref={ref}
      aria-hidden
      sx={{
        py: { xs: 4, md: 6 },
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        overflow: 'hidden',
        // Soften both ends so pills enter and leave instead of being cut.
        maskImage:
          'linear-gradient(90deg, transparent 0%, #000 7%, #000 93%, transparent 100%)',
      }}
    >
      <MotionBox style={reduceMotion ? undefined : { x: topX }}>
        <PillRow pills={ROW_TOP} />
      </MotionBox>
      <MotionBox style={reduceMotion ? undefined : { x: bottomX }}>
        <PillRow pills={ROW_BOTTOM} />
      </MotionBox>
    </Box>
  );
}
