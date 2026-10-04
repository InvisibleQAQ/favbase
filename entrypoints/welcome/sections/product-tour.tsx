import type { LocaleKeys } from '@/lib/i18n';
import type { Theme } from '@mui/material/styles';
import type { UseClientRectReturn } from 'minimal-shared/hooks';
import type { IconifyName } from '@/entrypoints/app/components/iconify';

import { useRef, useState } from 'react';
import { varAlpha } from 'minimal-shared/utils';
import { useClientRect } from 'minimal-shared/hooks';
// Replacement 1: `framer-motion` -> `motion/react`, `m` -> `motion`; no
// `LazyMotion` (docs/28 §3.2).
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useReducedMotion,
  useMotionValueEvent,
} from 'motion/react';

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import SvgIcon from '@mui/material/SvgIcon';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { styled, useTheme } from '@mui/material/styles';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';
import { PLATFORM_META } from '@/entrypoints/app/collection-platform-registry';

import { FadeIn } from '../components/fade-in';
import { varFade, MotionViewport } from '../components/animate';
import { TOUR_PAGES, tourImageSrc, type TourPage } from '../tour-images';
import { Headline, SectionCaption } from '../components/section-shell';
import { FloatLine, FloatPlusIcon } from '../components/svg-elements';

/**
 * Replacement 4: `home-highlight-features`' lines, value for value. The
 * platform picker carries the same three marks (it borrowed them in docs/31
 * Step 4); the repetition is known and accepted.
 */
const renderLines = () => (
  <>
    <FloatPlusIcon sx={{ top: 72, left: 72 }} />
    <FloatLine sx={{ top: 80, left: 0 }} />
    <FloatLine vertical sx={{ top: 0, left: 80 }} />
  </>
);

/**
 * Product tour: four real app.html screenshots in a gallery that scrolls
 * sideways while the page scrolls down. The only band on this page that shows
 * the product itself rather than a mock (docs/35).
 *
 * Minimal's `home-highlight-features`, ported value for value (user decision
 * 2026-10-03): the section and its title Stack measured by `useClientRect`,
 * then a runway as tall as the row is wide, a sticky container, and the row
 * moved by a spring over the runway's scroll progress. Every number (spacing,
 * spring physics, image widths, the shadow) is the source's.
 *
 * The geometry leaves the source in three places, each marked at its spot and
 * each fixing a defect measured on the built page:
 * - the stuck area starts below the page header and an item's width is capped
 *   by the height left there, because the source's sizes put an item's title
 *   under the header for the whole run (`ScrollContainer`,
 *   `stuckItemMaxWidth`);
 * - the icon is centred on the title's line, whatever that line's height is;
 * - the width sits on the item, so its text wraps inside it.
 *
 * Replaced only where favbase has no counterpart; each is marked at its spot:
 * 1. `framer-motion` / `m` -> `motion/react` / `motion`.
 * 2. The title is `SectionCaption` + `Headline tail` + a description, each in
 *    a `FadeIn`, not Minimal's `SectionTitle`.
 * 3. The two-triangle mark under the title is kept, with `aria-hidden`.
 * 4. The lines are the source's three marks, from `components/svg-elements`.
 * 5. `ITEMS` are the four pages of `tour-images.ts`.
 * 6. One background-image element per item, switched by scheme and locale.
 * 7. The sticky ground follows `home-hugepack-elements`' neutral ramp, not
 *    this file's five colour-preset gradients.
 * 8. No RTL branch.
 * 9. Reduced motion renders a plain column instead of the gallery.
 */
export function ProductTour() {
  const { t } = useTranslation();
  // Replacement 9: style-bound MotionValues bypass MotionConfig's
  // reducedMotion, so the gallery is gated by hand. The two branches are
  // separate components because `useScroll` throws on a target ref that never
  // mounts.
  const reduceMotion = useReducedMotion();
  const containerRoot = useClientRect<HTMLDivElement>();

  return (
    <Box
      id="welcome-tour"
      component="section"
      sx={{ position: 'relative', pt: { xs: 10, md: 20 } }}
    >
      <MotionViewport>
        {renderLines()}

        <Container maxWidth="lg">
          <Stack
            ref={containerRoot.elementRef}
            spacing={5}
            sx={{
              textAlign: { xs: 'center', md: 'left' },
              alignItems: { xs: 'center', md: 'flex-start' },
            }}
          >
            {/* Replacement 2: favbase's title block, laid out as in
                platform-picker, in the slot of Minimal's `SectionTitle`. */}
            <Box sx={{ maxWidth: 720 }}>
              <FadeIn y={-12}>
                <SectionCaption>{t('welcome.tour.eyebrow')}</SectionCaption>
              </FadeIn>
              <FadeIn delay={0.08} sx={{ mt: 3 }}>
                <Headline tail={t('welcome.tour.headingTail')}>{t('welcome.tour.heading')}</Headline>
              </FadeIn>
              <FadeIn delay={0.16}>
                <Typography
                  sx={{ mt: 2.5, color: 'text.secondary', lineHeight: 1.75, textWrap: 'pretty' }}
                >
                  {t('welcome.tour.desc')}
                </Typography>
              </FadeIn>
            </Box>

            {/* Replacement 3: the source's mark, driven by MotionViewport
                through its variants; decoration, so hidden from a11y. */}
            <SvgIcon
              component={motion.svg}
              variants={varFade('inDown', { distance: 24 })}
              aria-hidden
              sx={{ width: 28, height: 28, color: 'grey.500' }}
            >
              <path
                d="M13.9999 6.75956L7.74031 0.5H20.2594L13.9999 6.75956Z"
                fill="currentColor"
                opacity={0.12}
              />
              <path
                d="M13.9998 23.8264L2.14021 11.9668H25.8593L13.9998 23.8264Z"
                fill="currentColor"
                opacity={0.24}
              />
            </SvgIcon>
          </Stack>
        </Container>
      </MotionViewport>

      {reduceMotion ? <StackedContent /> : <ScrollableContent containerRoot={containerRoot} />}
    </Box>
  );
}

// ----------------------------------------------------------------------

interface TourItem {
  page: TourPage;
  icon: IconifyName;
  titleKey: LocaleKeys;
  descKey: LocaleKeys;
}

/**
 * Replacement 5: one entry per tour page. A title is the name the page itself
 * goes by: the Dashboard's and the aggregate page's `h1` keys, and the
 * registry's title and icon for the two platforms (no second copy of either).
 */
const ITEM_COPY: Record<TourPage, Omit<TourItem, 'page'>> = {
  dashboard: {
    icon: 'solar:graph-up-bold-duotone',
    titleKey: 'dashboard.title',
    descKey: 'welcome.tour.dashboard.desc',
  },
  collections: {
    icon: 'solar:layers-bold-duotone',
    titleKey: 'allCollections.title',
    descKey: 'welcome.tour.collections.desc',
  },
  github: {
    icon: PLATFORM_META.github.icon,
    titleKey: PLATFORM_META.github.title,
    descKey: 'welcome.tour.github.desc',
  },
  x: {
    icon: PLATFORM_META.x.icon,
    titleKey: PLATFORM_META.x.title,
    descKey: 'welcome.tour.x.desc',
  },
};

const ITEMS: TourItem[] = TOUR_PAGES.map((page) => ({ page, ...ITEM_COPY[page] }));

/** The source's image widths. An item holds one image, so they size the item. */
const ITEM_WIDTH = { xs: 480, sm: 640, md: 800, lg: 1140, xl: 1280 };

/** The captures' ratio (2400x1500), in the form CSS takes it. */
const SHOT_RATIO = '16 / 10';

/** The source's icon size, in px. */
const ICON_SIZE = 28;

// The source's spacing inside an item, in spacing units. The item's `sx` and
// the width cap both read these, so the cap cannot drift from the layout it
// is computed for.
/** Title to subtitle. */
const TEXT_GAP = 2;
/** Text block to image. */
const TEXT_MB = 6;

/**
 * Not the source's: air kept above and below a stuck item, in spacing units.
 * Without it an item whose width the cap decides fills the stuck area exactly,
 * its title against the header's edge and its image against the bottom of the
 * window. It also covers what the cap's budget leaves out: a second subtitle
 * line (24px) and the pixel the icon stands above the title's line.
 */
const STUCK_AIR = 3;

/** One line box of a typography variant, as a CSS length. */
const lineOf = ({ fontSize, lineHeight }: Theme['typography']['h3']) =>
  `calc(${fontSize} * ${lineHeight})`;

/**
 * Not the source's: the widest an item may be and still fit, whole, between
 * the page header and the bottom of the viewport while the gallery is stuck.
 *
 * The source lets an item be as tall as its image makes it and centres it in
 * 100vh. At 1440x900 that is a 713px image under a 114px text block, 827px in
 * all, and the title ends up under the 72px header. This page opens at
 * whatever size the user's window happens to be, usually a laptop's, so the
 * image gives way instead: its height is what the stuck area has left after
 * the title line, the gap, one subtitle line, the margin under the text and
 * `STUCK_AIR` on both sides, and the width follows from the captures' ratio.
 * From `md` that is (100vh - 234px) x 1.6: 1065.6px at 900px tall, 649.6px at
 * 640px. On a viewport tall enough (947px for the 1140px step) the cap is
 * wider than `ITEM_WIDTH` and the source's sizes stand.
 *
 * `--tour-header-height` is set by `ScrollContainer`. `ScrollRoot`'s height is
 * the row's `scrollWidth`, which `useClientRect` reads again on every window
 * resize, so the runway follows a width that depends on the viewport's height.
 */
function stuckItemMaxWidth(theme: Theme) {
  const { h3, body1 } = theme.typography;

  const taken = [
    'var(--tour-header-height)',
    lineOf(h3),
    theme.spacing(TEXT_GAP),
    lineOf(body1),
    theme.spacing(TEXT_MB),
    theme.spacing(2 * STUCK_AIR),
  ].join(' - ');

  return `calc((100vh - ${taken}) * ${SHOT_RATIO})`;
}

type ScrollContentProps = {
  containerRoot: UseClientRectReturn;
};

function ScrollableContent({ containerRoot }: ScrollContentProps) {
  const theme = useTheme();

  const containerRef = useRef<HTMLDivElement>(null);
  const containerRect = useClientRect(containerRef);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRect = useClientRect(scrollRef);

  const { scrollYProgress } = useScroll({ target: containerRef });

  const [startScroll, setStartScroll] = useState(false);

  const physics = { damping: 16, mass: 0.12, stiffness: 80 };

  // Replacement 8: no `isRtl` sign flip; the repo has no direction support.
  const scrollRange = -scrollRect.scrollWidth + containerRect.width / 2;

  const x = useSpring(useTransform(scrollYProgress, [0, 1], [0, scrollRange]), physics);

  // Replacement 7: `home-hugepack-elements`' ramp. The source cycles the five
  // `primaryColorPresets` gradients, which is that band's own subject. These
  // stops are CSS variables, which motion steps between rather than blends;
  // the `background-color` transition on `ScrollContainer` is what eases it.
  const background = useTransform(
    scrollYProgress,
    [0, 0.25, 0.5, 0.75, 1],
    [
      theme.vars.palette.background.default,
      theme.vars.palette.background.neutral,
      theme.vars.palette.background.neutral,
      theme.vars.palette.background.neutral,
      theme.vars.palette.background.default,
    ]
  );

  useMotionValueEvent(scrollYProgress, 'change', (latest) => {
    setStartScroll(latest !== 0 && latest !== 1);
  });

  return (
    <ScrollRoot ref={containerRef} sx={{ height: scrollRect.scrollWidth, minHeight: '100vh' }}>
      <ScrollContainer style={{ background }} data-scrolling={startScroll}>
        <ScrollContent
          ref={scrollRef}
          style={{ x }}
          layout
          sx={{ ml: `${containerRoot.left}px` }}
          transition={{ ease: 'linear', duration: 0.25 }}
        >
          {ITEMS.map((item) => (
            <Item key={item.page} item={item} />
          ))}
        </ScrollContent>
      </ScrollContainer>
    </ScrollRoot>
  );
}

/**
 * Replacement 9, the reduced-motion band: no runway, no sticky container and
 * no bound MotionValue. The same items in a column, on the gallery's own
 * spacing (`ScrollRoot`'s top padding, `ScrollContent`'s gap), each image as
 * wide as the Container.
 */
function StackedContent() {
  return (
    <Container maxWidth="lg" sx={{ pt: { xs: 5, md: 8 } }}>
      <Stack spacing={{ xs: 5, md: 8 }}>
        {ITEMS.map((item) => (
          <Item key={item.page} item={item} stacked />
        ))}
      </Stack>
    </Container>
  );
}

// ----------------------------------------------------------------------

// Replacement 1 again: `styled(m.div)` -> `styled(motion.div)`.
const ScrollRoot = styled(motion.div)(({ theme }) => ({
  zIndex: 9,
  position: 'relative',
  paddingTop: theme.spacing(5),
  [theme.breakpoints.up('md')]: { paddingTop: theme.spacing(8) },
}));

const ScrollContainer = styled(motion.div)(({ theme }) => ({
  // Not the source's (`top: 0`, `height: '100vh'`): the stuck area is what the
  // page header leaves, not the whole viewport, so the row is centred in the
  // part of the window a reader can see. The header is sticky, 64px tall and
  // 72px from `md` (`WelcomeLayout`'s `layoutQuery`, as the hero reads it);
  // the items' width cap reads the same variable.
  '--tour-header-height': 'var(--layout-header-mobile-height)',
  top: 'var(--tour-header-height)',
  height: 'calc(100vh - var(--tour-header-height))',
  display: 'flex',
  position: 'sticky',
  overflow: 'hidden',
  flexDirection: 'column',
  alignItems: 'flex-start',
  transition: theme.transitions.create(['background-color']),
  '&[data-scrolling="true"]': { justifyContent: 'center' },
  [theme.breakpoints.up('md')]: {
    '--tour-header-height': 'var(--layout-header-desktop-height)',
  },
}));

const ScrollContent = styled(motion.div)(({ theme }) => ({
  display: 'flex',
  gap: theme.spacing(5),
  paddingLeft: theme.spacing(3),
  transition: theme.transitions.create(['margin-left', 'margin-top']),
  [theme.breakpoints.up('md')]: {
    gap: theme.spacing(8),
    paddingLeft: theme.spacing(0),
  },
}));

// ----------------------------------------------------------------------

function Item({ item, stacked = false }: { item: TourItem; stacked?: boolean }) {
  const { t, locale } = useTranslation();
  const title = t(item.titleKey);

  return (
    // Not the source's: the width sits on the item, not on the image. The
    // source sizes the image element and lets the text row take its
    // max-content width, so a subtitle longer than the image widens the item
    // past it. With the width here the text wraps inside it and the frame
    // fills it (a background-image box has no width of its own, and each item
    // has exactly one image). In the gallery the width is also capped by the
    // stuck area's height.
    <Box
      data-slot="tour-item"
      sx={(theme) => ({
        flexShrink: 0,
        ...(stacked ? { width: 1 } : { width: ITEM_WIDTH, maxWidth: stuckItemMaxWidth(theme) }),
      })}
    >
      <Box sx={{ mb: TEXT_MB, gap: 2, display: 'flex' }}>
        {/* Not the source's `mt: '10px'`: that centres the icon on Minimal's
            `h3` line at `lg` (48px), and this theme's line is 26px. The
            offset is half of what the title's line has over the icon, so it
            follows the theme. */}
        <Iconify
          width={ICON_SIZE}
          icon={item.icon}
          sx={(theme) => ({
            mt: `calc((${lineOf(theme.typography.h3)} - ${ICON_SIZE}px) / 2)`,
          })}
        />
        <Stack spacing={TEXT_GAP} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3">{title}</Typography>
          <Typography sx={{ color: 'text.secondary' }}>{t(item.descKey)}</Typography>
        </Stack>
      </Box>

      {/* The source's frame, as wide as the item. */}
      <Box
        sx={(theme) => ({
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: `-40px 40px 80px 0px ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
          ...theme.applyStyles('dark', {
            boxShadow: `-40px 40px 80px 0px ${varAlpha(theme.vars.palette.common.blackChannel, 0.16)}`,
          }),
        })}
      >
        {/* Replacement 6: one box with a background image, not an image
            element per scheme. The pattern is `home-hugepack-elements`'
            `bundle-light-*` / `bundle-dark-*`. */}
        <Box
          role="img"
          aria-label={t('welcome.tour.imageAlt', { title })}
          sx={(theme) => ({
            aspectRatio: SHOT_RATIO,
            backgroundSize: 'cover',
            backgroundImage: `url(${tourImageSrc(item.page, 'light', locale)})`,
            ...theme.applyStyles('dark', {
              backgroundImage: `url(${tourImageSrc(item.page, 'dark', locale)})`,
            }),
          })}
        />
      </Box>
    </Box>
  );
}
