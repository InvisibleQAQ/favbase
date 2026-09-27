import type { ElementType, ReactNode } from 'react';
import type { BoxProps } from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify, type IconifyName } from '@/entrypoints/app/components/iconify';

/**
 * Primary-CTA glow. The hero and picker "main action" buttons share the exact
 * same halo — defined once so the two can never drift apart visually.
 */
export function ctaGlowShadow(theme: Theme) {
  return `0 10px 28px 0 ${varAlpha(theme.vars.palette.primary.mainChannel, 0.34)}`;
}

/**
 * The page's display gradient, painted as text: grey into coral in light mode,
 * inverted (white into coral light) in dark so the glyphs stay the brightest
 * thing on screen.
 *
 * Shared by `Headline` and the how-it-works step numerals — the two must not
 * drift, which is exactly what happened while this lived in `welcome.css` as a
 * `.fb-headline` class plus two blocks of hard-coded hex.
 *
 * Minimal's own section titles fade to *grey* (text.primary -> 20% alpha)
 * because it ships as a neutral UI kit; favbase has a brand colour.
 */
export function headlineGradient(theme: Theme) {
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

/** Vertical rhythm for every band on the page. */
export function WelcomeSection({
  id,
  children,
  sx,
  ...other
}: BoxProps & { id?: string; children: ReactNode }) {
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
      <Container maxWidth="lg">{children}</Container>
    </Box>
  );
}

/** Small pill above a headline: dot/icon + tracked-out label. */
export function Eyebrow({ children, icon }: { children: ReactNode; icon?: IconifyName }) {
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
      {icon ? (
        <Iconify icon={icon} width={16} sx={{ color: 'primary.main' }} />
      ) : (
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'primary.main' }} />
      )}
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
 * Which ink a `Headline` is painted in. The union is what keeps `tail` off the
 * brand form: the tail fades white into 40% white, which only reads on a dark
 * surface and vanishes on the light page.
 */
type HeadlineInk =
  | { ink?: 'brand'; tail?: never }
  | { ink: 'white'; tail?: ReactNode };

/**
 * Oversized display headline. `hero` is the first-screen size; `section` is
 * every band below it.
 *
 * `ink="brand"` (the default) paints `headlineGradient` above. `ink="white"` is
 * solid `common.white` for the grey.900 CTA card at the end of the page
 * (`platform-request.tsx`, Minimal's `home-advertisement`): the brand gradient
 * starts at grey.800, which disappears into that card in light mode. The white
 * form alone takes a `tail`, the closing word(s) faded white -> 40% white
 * exactly as Minimal's advertisement title does. Head and tail are joined here,
 * by locale: a space in latin scripts, nothing in CJK, so neither translated
 * half carries the separator. It is a text node rather than Minimal's `ml: 1`:
 * a line break between the halves then leaves no indent, and CJK gets no gap.
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
  ink = 'brand',
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
          // The brand gradient's `background-clip: text` has to sit on the
          // element that paints the glyphs, which is this one.
          ...(ink === 'white'
            ? { color: theme.vars.palette.common.white }
            : headlineGradient(theme)),
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
          <Box
            component="span"
            sx={(theme) =>
              theme.mixins.textGradient(
                `to right, ${theme.vars.palette.common.white}, ${varAlpha(theme.vars.palette.common.whiteChannel, 0.4)}`
              )
            }
          >
            {tail}
          </Box>
        </>
      )}
    </Box>
  );
}
