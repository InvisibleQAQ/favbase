import type { ElementType, ReactNode } from 'react';
import type { BoxProps } from '@mui/material/Box';
import type { CSSObject, Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify, type IconifyName } from '@/entrypoints/app/components/iconify';

import { MotionViewport } from './animate';

/**
 * Primary-CTA glow. The hero and picker "main action" buttons share the exact
 * same halo — defined once so the two can never drift apart visually.
 */
export function ctaGlowShadow(theme: Theme) {
  return `0 10px 28px 0 ${varAlpha(theme.vars.palette.primary.mainChannel, 0.34)}`;
}

/**
 * The hero's display gradient, painted as text: grey into coral in light mode,
 * inverted (white into coral light) in dark so the glyphs stay the brightest
 * thing on screen. `Headline ink="brand"` is its only consumer, so it is not
 * exported.
 *
 * Colour on the hero, neutral grey on every section below it is Minimal's own
 * split (docs/31 Step 3): its hero carries the coloured words, its section
 * titles fade grey (`fadeTextGradient` below).
 */
function headlineGradient(theme: Theme): CSSObject {
  return {
    ...theme.mixins.textGradient(
      `112deg, ${theme.vars.palette.grey['800']} 0%, ${theme.vars.palette.grey['700']} 42%, ${theme.vars.palette.primary.main} 100%`
    ),
    ...theme.applyStyles('dark', {
      ...theme.mixins.textGradient(
        `112deg, ${theme.vars.palette.common.white} 0%, ${theme.vars.palette.grey['400']} 38%, ${theme.vars.palette.primary.light} 100%`
      ),
    }),
  };
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

/**
 * The small line above a section's `Headline`: Minimal's `SectionCaption`, a
 * bare overline (600 / 12px / uppercase, from the theme) with no pill and no
 * icon. Entrance motion stays with the call site's `FadeIn` (docs/28 D6).
 *
 * Colour is `text.secondary`, not Minimal's `text.disabled`: that one reads
 * ~2.7:1 on white and ~3.6:1 on the dark page, this one ~4.9:1 and ~6.4:1.
 *
 * A block, where Minimal's is a `span`: there it is a flex item, which
 * blockifies it; here it sits in `FadeIn`'s block div, where an inline span
 * would take the div's line strut and stand taller than its own 18px line.
 */
export function SectionCaption({ children }: { children: ReactNode }) {
  return <Box sx={{ typography: 'overline', color: 'text.secondary' }}>{children}</Box>;
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
 * section title, `brand` for the hero, `white` for the grey.900 card at the end
 * of the page. The union is what keeps `tail` off `brand`: the brand gradient
 * already runs across the whole line, and a fade laid over it has no defined
 * colour.
 */
type HeadlineInk =
  | { ink?: 'neutral'; tail?: ReactNode }
  | { ink: 'white'; tail?: ReactNode }
  | { ink: 'brand'; tail?: never };

type InkStyle = (theme: Theme) => CSSObject;

/**
 * What each ink paints: the headline, and the tail for the inks that take one.
 * Each tail keeps its source's box: `inline-block` for the neutral one
 * (Minimal's section title), plain inline for the white one (Minimal's
 * advertisement title).
 */
const INKS: Record<NonNullable<HeadlineInk['ink']>, { head: InkStyle; tail?: InkStyle }> = {
  neutral: {
    head: (theme) => ({ color: theme.vars.palette.text.primary }),
    tail: (theme) => ({ display: 'inline-block', ...fadeTextGradient(theme) }),
  },
  brand: { head: headlineGradient },
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
 * `tail` and faded through `fadeTextGradient`. `brand` paints
 * `headlineGradient` and belongs to the hero alone. `white` is solid
 * `common.white` for the grey.900 CTA card at the end of the page
 * (`platform-request.tsx`, Minimal's `home-advertisement`), its tail faded
 * white -> 40% white exactly as Minimal's advertisement title does; in light
 * mode the other two inks start from dark greys that disappear into that card.
 *
 * Head and tail are joined here, by locale: a space in latin scripts, nothing
 * in CJK, so neither translated half carries the separator. Minimal's
 * advertisement title offsets its tail with `ml: 1` and its section title
 * bakes a space into the head string; with a text node chosen by locale, a
 * line break between the halves leaves no indent and CJK gets no gap.
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
  const isCjk = locale === 'zh-CN';

  return (
    <Box
      component={component}
      sx={[
        (theme) => ({
          m: 0,
          // A gradient ink's `background-clip: text` has to sit on the element
          // that paints the glyphs, which is this one.
          ...INKS[ink].head(theme),
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
          <Box component="span" sx={INKS[ink].tail}>
            {tail}
          </Box>
        </>
      )}
    </Box>
  );
}
