import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';
import { PLATFORM_REQUEST_ISSUE_URL } from '@/lib/repo';

import { FadeIn } from '../components/fade-in';
import { MotionBox } from '../components/motion-box';
import { MotionViewport } from '../components/animate';
import { Headline } from '../components/section-shell';
import { FloatLine, FloatPlusIcon } from '../components/svg-elements';

/** Minimal's rocket, copied byte for byte and kept under Minimal's path. */
const ROCKET_SRC = '/assets/illustrations/illustration-rocket-large.webp';

/**
 * Platform Request (CONTEXT.md): closing outbound nudge — today's platforms
 * are a starting point; ask for the next one on the issue tracker.
 *
 * Minimal's `home-advertisement` card, ported as-is (docs/31 Step 2, user
 * decision 2026-09-27). That decision overturned two earlier ones: docs/28
 * §3.4 had rejected the Advertisement band as sales copy, and this band used to
 * be deliberately modest (outlined, no glow) so it would not compete with the
 * picker's "Enter favbase" CTA right above. The dark card no longer yields to
 * that CTA; that is the direct cost of porting Minimal as-is.
 *
 * Replaced only where favbase has no counterpart:
 * - Minimal has no description; ours stays under the title in a fixed
 *   grey.500 (text.secondary follows the scheme, the card does not).
 * - One button, not two: the issue link is the band's only action, so it takes
 *   the contained primary slot and keeps its external-link icon.
 * - The title is `Headline ink="white"` with the last word as its `tail`
 *   (Minimal's white -> 40% white fade), not `variant h1/h2` (docs/28 E2).
 * - Minimal's `spacing: 5` on the card is dropped: it sits in a Box's `sx`,
 *   where it emits no valid CSS.
 *
 * The lines came across in docs/31 Step 4, value for value (`renderLines`
 * below): the spine runs on from the band above and stops 64px past the card's
 * midline, where a full-width rule crosses it under a `+`. That rule passes
 * behind the card, which is what the Container's `position: relative` +
 * `zIndex: 9` is for. As in Minimal, the lines are the Container's siblings,
 * so they are placed against this section, not against the lifted Container.
 *
 * Spacing is Minimal's as well: a bare `section` + `Container` with no vertical
 * padding of its own, off `WelcomeSection`'s page rhythm. The picker's bottom
 * padding is the gap above, the footer's `py: 5` the gap below. This band used
 * to sit in `WelcomeSection` with `pt: 0`, which never applied from md up: the
 * responsive `py` there is a media rule, and a scalar override of the same
 * property lands only in the base rule, so it lost (160px measured at 1440).
 *
 * Motion matches Minimal's directions and distances through `FadeIn`: rocket
 * inUp 120 (varFade's default), title inDown 24, button inRight 24.
 */
export function PlatformRequest() {
  const { t } = useTranslation();

  return (
    <Box component="section" sx={{ position: 'relative' }}>
      <MotionViewport>
        {renderLines()}

        <Container maxWidth="lg" sx={{ position: 'relative', zIndex: 9 }}>
          <Box
            sx={(theme) => ({
              ...theme.mixins.bgGradient({
                images: [
                  `linear-gradient(0deg, ${varAlpha(theme.vars.palette.grey['500Channel'], 0.04)} 1px, transparent 1px)`,
                  `linear-gradient(90deg, ${varAlpha(theme.vars.palette.grey['500Channel'], 0.04)} 1px, transparent 1px)`,
                ],
                sizes: ['36px 36px'],
                repeats: ['repeat'],
              }),
              py: 8,
              px: 5,
              borderRadius: 3,
              display: 'flex',
              overflow: 'hidden',
              bgcolor: 'grey.900',
              position: 'relative',
              alignItems: 'center',
              textAlign: { xs: 'center', md: 'left' },
              flexDirection: { xs: 'column', md: 'row' },
              border: `solid 1px ${theme.vars.palette.grey[800]}`,
            })}
          >
            <Rocket />

            <Stack spacing={5} sx={{ zIndex: 9 }}>
              <FadeIn y={-24} delay={0.05}>
                <Headline ink="white" tail={t('welcome.request.headingTail')}>
                  {t('welcome.request.heading')}
                </Headline>
                <Typography
                  sx={{
                    mt: 2,
                    maxWidth: 520,
                    mx: { xs: 'auto', md: 0 },
                    color: 'grey.500',
                    lineHeight: 1.75,
                    textWrap: 'pretty',
                  }}
                >
                  {t('welcome.request.desc')}
                </Typography>
              </FadeIn>

              <Box
                sx={{
                  gap: 2,
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: { xs: 'center', md: 'flex-start' },
                }}
              >
                <FadeIn x={24} y={0} delay={0.1}>
                  <Button
                    size="large"
                    variant="contained"
                    color="primary"
                    component="a"
                    href={PLATFORM_REQUEST_ISSUE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    endIcon={<Iconify icon="eva:diagonal-arrow-right-up-fill" width={18} />}
                  >
                    {t('welcome.request.cta')}
                  </Button>
                </FadeIn>
              </Box>
            </Stack>

            <Blur />
          </Box>
        </Container>
      </MotionViewport>
    </Box>
  );
}

const renderLines = () => (
  <>
    <FloatPlusIcon sx={{ left: 72, top: '50%', mt: -1 }} />
    <FloatLine vertical sx={{ top: 0, left: 80, height: 'calc(50% + 64px)' }} />
    <FloatLine sx={{ top: '50%', left: 0 }} />
  </>
);

/**
 * Decorative (`alt=""`), floating on a declarative `animate` loop that the
 * page's `MotionConfig reducedMotion="user"` already stills. The `<img>` sits
 * inside the floating MotionBox instead of being it: MotionBox is typed as a
 * div, so it cannot take `src`/`alt`.
 */
function Rocket() {
  return (
    <FadeIn y={120}>
      <MotionBox
        animate={{ y: [-20, 0, -20] }}
        transition={{ duration: 4, repeat: Infinity }}
        sx={{ zIndex: 9, width: 360, aspectRatio: '1/1', position: 'relative' }}
      >
        <Box
          component="img"
          alt=""
          src={ROCKET_SRC}
          sx={{ display: 'block', width: 1, height: 1 }}
        />
      </MotionBox>
    </FadeIn>
  );
}

/** Minimal's top-right light spot, under the rocket and the copy (zIndex 7 < 9). */
function Blur() {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        top: 0,
        right: 0,
        zIndex: 7,
        width: 1,
        opacity: 0.4,
        maxWidth: 420,
        aspectRatio: '1/1',
        position: 'absolute',
        backgroundImage: `radial-gradient(farthest-side at top right, ${theme.vars.palette.grey[500]} 0%, ${varAlpha(theme.vars.palette.grey['500Channel'], 0.08)} 75%, transparent 90%)`,
      })}
    />
  );
}
