import type { ElementType, ReactNode } from 'react';
import type { MotionProps } from 'motion/react';
import type { BoxProps } from '@mui/material/Box';
import type { CSSObject, Theme } from '@mui/material/styles';

import { useReducedMotion } from 'motion/react';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify, type IconifyName } from '@/entrypoints/app/components/iconify';

import { MotionViewport } from './animate';
import { MotionBox } from './motion-box';

/**
 * Primary-CTA glow. The hero and picker "main action" buttons share the exact
 * same halo — defined once so the two can never drift apart visually.
 */
export function ctaGlowShadow(theme: Theme) {
  return `0 10px 28px 0 ${varAlpha(theme.vars.palette.primary.mainChannel, 0.34)}`;
}

/**
 * The section titles' fade, painted as text: `text.primary` into 20% of itself,
 * left to right. Palette variables, so dark mode needs no branch of its own.
 *
 * Shared by a neutral `Headline`'s tail and the how-it-works step numerals —
 * the two must not drift, which is what the numerals risked while they wore
 * the old `.fb-headline` class directly instead of going through `Headline`
 * (docs/28 E3).
 *
 * Minimal's section title stacks `opacity: 0.4` on this same gradient. Dropped
 * on purpose (docs/31 Step 3): favbase's tails carry meaning ("knowledge base",
 * "while you watch"), and with the opacity the tail starts at ~2.4:1 on white
 * instead of text.primary's ~15.5:1.
 */
export function fadeTextGradient(theme: Theme): CSSObject {
  return theme.mixins.textGradient(
    `to right, ${theme.vars.palette.text.primary}, ${varAlpha(theme.vars.palette.text.primaryChannel, 0.2)}`
  );
}

/**
 * Vertical rhythm for the page's content bands. A band with geometry of its own
 * brings its own wrapper and padding instead: the hero, the marquee,
 * how-it-works' sticky stack, the product tour's scroll gallery, and the
 * closing Platform Request card, which has no vertical padding at all
 * (Minimal's advertisement band).
 *
 * A call site overriding `py`/`pt`/`pb` must give the `md` value too: a scalar
 * lands in the base rule only and loses to this component's `md` media rule.
 *
 * `lines` is the band's decoration (`components/svg-elements`), laid out as in
 * each Minimal section: `section > MotionViewport > lines + Container`. The
 * lines are the Container's siblings, positioned against this `position:
 * relative` section, and drawn when `MotionViewport` sees the band.
 */
export function WelcomeSection({
  id,
  children,
  lines,
  sx,
  ...other
}: BoxProps & { id?: string; children: ReactNode; lines?: ReactNode }) {
  return (
    <Box
      id={id}
      component="section"
      sx={[
        { position: 'relative', py: { xs: 10, md: 20 } },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    >
      <MotionViewport>
        {lines}
        <Container maxWidth="lg">{children}</Container>
      </MotionViewport>
    </Box>
  );
}

/** A paint for `SectionCaption` or `Headline`, keyed by ink in each one's table. */
type InkStyle = (theme: Theme) => CSSObject;

/** What each `SectionCaption` ink paints; the comment below has the why. */
const CAPTION_INKS = {
  neutral: (theme) => ({ color: theme.vars.palette.text.secondary }),
  white: (theme) =>
    theme.mixins.textGradient(
      `to right, ${theme.vars.palette.common.white}, ${varAlpha(theme.vars.palette.common.whiteChannel, 0.48)}`
    ),
} satisfies Record<string, InkStyle>;

/**
 * The small line above a section's `Headline`: Minimal's `SectionCaption`, a
 * bare overline (600 / 12px / uppercase, from the theme) with no pill and no
 * icon. Entrance motion stays with the call site's `FadeIn` (docs/28 D6).
 *
 * The default ink is `text.secondary`, not Minimal's `text.disabled`: that
 * one reads ~2.7:1 on white and ~3.6:1 on the dark page, this ~4.9:1 / ~6.4:1.
 *
 * A block, where Minimal's is a `span`: there it is a flex item, which
 * blockifies it; here it sits in `FadeIn`'s block div, where an inline span
 * would take the div's line strut and stand taller than its own 18px line.
 *
 * `ink="white"` is for agent-skills' dark band: Minimal for-designer's caption,
 * white fading to the right, with the end raised from Minimal's 20% white
 * (~1.91:1 on the band) to 48%, the readable floor (~4.67:1 at the worst point;
 * docs/39 Step 5 Q4). The fade spans the caption's box, so it reads only where
 * the box is the text: agent-skills' centred flex column shrink-wraps its
 * `FadeIn`, and this block with it, to the caption; in a full-width column the
 * fade would end out past the last letter.
 */
export function SectionCaption({
  children,
  ink = 'neutral',
}: {
  children: ReactNode;
  ink?: keyof typeof CAPTION_INKS;
}) {
  return (
    <Box sx={(theme) => ({ typography: 'overline', ...CAPTION_INKS[ink](theme) })}>
      {children}
    </Box>
  );
}

/**
 * Pill with an icon and a tracked-out label: the check-marked hint inside each
 * how-it-works card, its only consumer. It is not a section caption — the line
 * above a `Headline` is `SectionCaption`.
 */
export function Eyebrow({ children, icon }: { children: ReactNode; icon: IconifyName }) {
  return (
    <Box
      sx={(theme) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 1,
        px: 1.5,
        py: 0.75,
        borderRadius: 999,
        color: 'text.secondary',
        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
        border: `1px solid ${varAlpha(theme.vars.palette.grey['500Channel'], 0.16)}`,
      })}
    >
      <Iconify icon={icon} width={16} sx={{ color: 'primary.main' }} />
      <Typography
        variant="caption"
        sx={{ fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}
      >
        {children}
      </Typography>
    </Box>
  );
}

/**
 * Which ink a `Headline` is painted in: `neutral` (the default) for every
 * section title, `muted` and `brand` for the hero's first and second lines,
 * `warm` for agent-skills' dark band, `white` for the grey.900 card at the end
 * of the page. The union pins the tail per ink: `brand` and `warm` must have
 * one, because the tail is all they paint differently (the brand word; the
 * amber -> coral run) and without it each would paint exactly what neutral
 * paints under another name; `muted` refuses one, because the hero's first
 * line has no second half and no tail paint has been designed to follow a
 * `text.secondary` head.
 */
type HeadlineInk =
  | { ink?: 'neutral'; tail?: ReactNode }
  | { ink: 'white'; tail?: ReactNode }
  | { ink: 'brand'; tail: ReactNode }
  | { ink: 'warm'; tail: ReactNode }
  | { ink: 'muted'; tail?: never };

/**
 * Solid `text.primary`: the head of a neutral title, of the hero's brand line
 * and of the warm title, which is white only because its band forces the dark
 * scheme.
 */
const primaryHead: InkStyle = (theme) => ({ color: theme.vars.palette.text.primary });

/**
 * What each ink paints: the headline, the tail for the inks that take one, and
 * for the one tail that moves, the motion props that move it (`flow`). The
 * table is the whole difference between inks: `Headline` has no ink branch.
 *
 * Each tail keeps its source's box. `inline-block` for the neutral one
 * (Minimal's section title) and for the brand word: Minimal's brand span is a
 * flex item of a `flex-wrap` h1, which blockifies it. Here it must be a box of
 * its own for the same reason as the neutral tail (docs/31 Step 3, D-d): an
 * inline background is sliced across line fragments, and 「知识库」 may break
 * between any two characters, leaving each piece a different stretch of the
 * gradient. Plain inline for the white one (Minimal's advertisement title).
 * The warm tail has no source box (Minimal paints that whole title) and takes
 * `inline-block` for the brand word's reasons; its row says why tail only.
 */
const INKS: Record<
  NonNullable<HeadlineInk['ink']>,
  { head: InkStyle; tail?: InkStyle; flow?: Pick<MotionProps, 'animate' | 'transition'> }
> = {
  neutral: {
    head: primaryHead,
    tail: (theme) => ({ display: 'inline-block', ...fadeTextGradient(theme) }),
  },
  // Minimal's brand word value for value (`home-hero.tsx:82-103`): a 300deg
  // coral / amber run, scaled to 400% and walked by `background-position`.
  // Palette variables are safe here, unlike in the product tour's stage: the
  // flow moves the position and never interpolates a colour. Both schemes take
  // the same paint, as in Minimal. `backgroundSize` must come after the mixin,
  // whose `background` shorthand would reset it.
  brand: {
    head: primaryHead,
    tail: (theme) => ({
      display: 'inline-block',
      ...theme.mixins.textGradient(
        `300deg, ${theme.vars.palette.primary.main} 0%, ${theme.vars.palette.warning.main} 25%, ${theme.vars.palette.primary.main} 50%, ${theme.vars.palette.warning.main} 75%, ${theme.vars.palette.primary.main} 100%`
      ),
      backgroundSize: '400%',
    }),
    flow: {
      animate: { backgroundPosition: '200% center' },
      transition: { duration: 20, ease: 'linear', repeat: Infinity, repeatType: 'reverse' },
    },
  },
  // Minimal for-designer's title tokens and angle (`home-for-designer.tsx:95-97`,
  // docs/39 Step 5 Q3), painted on the tail only. The inline-block box is the
  // ink, so both ends of the run show; across the whole title the gradient
  // would spread on the 760px column box once the title wraps, leaving the ink
  // a middle stretch of it (docs/39 Step 3's "spread on the column box" bug).
  // Static, unlike brand: a second flowing word would compete with the hero's.
  // Reads only on a dark ground: agent-skills forces the dark scheme on its
  // band, where `primaryHead` is white and the tail 6.5-8.7:1; on white the
  // tail is 1.9-2.5:1.
  warm: {
    head: primaryHead,
    tail: (theme) => ({
      display: 'inline-block',
      ...theme.mixins.textGradient(
        `135deg, ${theme.vars.palette.warning.main}, ${theme.vars.palette.primary.main}`
      ),
    }),
  },
  muted: { head: (theme) => ({ color: theme.vars.palette.text.secondary }) },
  white: {
    head: (theme) => ({ color: theme.vars.palette.common.white }),
    tail: (theme) =>
      theme.mixins.textGradient(
        `to right, ${theme.vars.palette.common.white}, ${varAlpha(theme.vars.palette.common.whiteChannel, 0.4)}`
      ),
  },
};

/**
 * Oversized display headline. `hero` is the first-screen size; `section` is
 * every band below it.
 *
 * `ink` picks the paint (`INKS` above). `neutral`, the default, is Minimal's
 * section title: solid `text.primary`, with the closing word(s) passed as
 * `tail` and faded through `fadeTextGradient`. The hero takes Minimal's
 * three-level title (`home-hero.tsx:58-106`, docs/39 Step 3) and these two
 * inks belong to it alone: `muted` is its first line, solid `text.secondary`
 * where Minimal fades that line to 0.24 opacity (~1.63:1 on white; this is
 * the readable floor, ~4.9:1); `brand` is its second, a solid `text.primary`
 * head with the brand word as `tail`, flowing through coral and amber. Colour
 * on the hero, neutral on every band below it is Minimal's own split
 * (docs/31 Step 3), and so is its one exception: `warm` is Minimal
 * for-designer's title on agent-skills' dark band (docs/39 Step 5), a solid
 * head and a still amber -> coral tail that read only on that band's forced
 * dark scheme. `white` is solid `common.white` for the grey.900 CTA card
 * at the end of the page (`platform-request.tsx`, Minimal's
 * `home-advertisement`), its tail faded white -> 40% white exactly as
 * Minimal's advertisement title does; the other inks' heads are greys tuned
 * for the page ground and sink into that card in light mode.
 *
 * The flow runs on `background-position`, which `MotionConfig
 * reducedMotion="user"` does not stop (welcome/CLAUDE.md "动画"), so it is
 * gated here by hand: under "reduce motion" the tail gets no `animate` and
 * stays on its first frame, a still coral / amber gradient. Every ink's tail
 * is the same `MotionBox`; one with no `flow` is inert.
 *
 * Head and tail are joined here, by locale: a space in latin scripts, nothing
 * in CJK, so neither translated half carries the separator. Minimal's
 * advertisement title and hero brand word offset their tails with `ml`, and
 * its section title bakes a space into the head string; with a text node
 * chosen by locale, a line break between the halves leaves no indent and CJK
 * gets no gap.
 *
 * The neutral tail is an `inline-block`, as in Minimal's section title: when
 * it does not fit after the head it drops to the next line whole, and its
 * fade runs across the tail alone. An inline tail was tried first (docs/31
 * Step 3, D-d) and wrapped word by word instead, but an inline background is
 * sliced across its line fragments, so the words carried onto the next line
 * took only the fade's last stretch: alone on a line and close to 20% ink
 * ("while you / watch" at 390px, 「右边多 / 一块」 at 1440px).
 *
 * Sizes stay on `clamp()` and do NOT switch to `variant="h1"/"h2"`: this app's
 * typography scale was deliberately compressed when `theme/core` was ported
 * (docs/25 Step 1 dropped Minimal's `responsiveFontSizes`, so h1 is a flat
 * 28px and h2 a flat 24px — right for a dashboard title bar, far too small for
 * a landing headline). Minimal's own h1 runs 40 -> 64px, which is what these
 * clamps already approximate.
 *
 * Renders a real heading (`h2` by default) so the page keeps a document
 * outline; pass `component` to change the level, or `span` when the semantic
 * wrapper lives outside (the hero nests two lines inside a single h1).
 *
 * Metrics are locale-aware: the latin display treatment (negative tracking +
 * sub-1 line-height) crowds CJK glyphs — which fill their em box — and risks
 * clipping them under the hero's overflow-hidden reveals, so zh relaxes both.
 */
export function Headline({
  children,
  size = 'section',
  component = 'h2',
  sx,
  ink = 'neutral',
  tail,
}: {
  children: ReactNode;
  size?: 'hero' | 'section';
  component?: ElementType;
  sx?: BoxProps['sx'];
} & HeadlineInk) {
  const { locale } = useTranslation();
  const reduceMotion = useReducedMotion();
  const isCjk = locale === 'zh-CN';
  const { head, tail: tailInk, flow } = INKS[ink];

  return (
    <Box
      component={component}
      sx={[
        (theme) => ({
          m: 0,
          ...head(theme),
          fontFamily: theme.typography.fontSecondaryFamily,
          fontWeight: 800,
          lineHeight: isCjk ? 1.12 : 0.98,
          letterSpacing: isCjk ? 0 : '-0.03em',
          // Capped low enough that the longest localized line (English hero
          // copy is ~15 characters) still fits its column without wrapping
          // into a third line.
          fontSize:
            size === 'hero' ? 'clamp(2.5rem, 7.5vw, 5.5rem)' : 'clamp(2rem, 5vw, 3.5rem)',
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
      {tail != null && (
        <>
          {!isCjk && ' '}
          <MotionBox
            component="span"
            sx={tailInk}
            animate={reduceMotion ? undefined : flow?.animate}
            transition={flow?.transition}
          >
            {tail}
          </MotionBox>
        </>
      )}
    </Box>
  );
}
