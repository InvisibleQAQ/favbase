import { motion } from 'motion/react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '@/entrypoints/app/components/iconify';
import { collectionPlatformRegistry } from '@/entrypoints/app/collection-platform-registry';

import { Magnet } from './magnet';
import { MotionBox } from './motion-box';

/** One full turn of the platform ring. Slow enough to read as ambient. */
const SPIN_SECONDS = 46;
const STEP = 360 / collectionPlatformRegistry.length;

/** SVG space is 200×200; the ring sits at r=76, spokes span r=34→r=70. */
const RING_R = 76;
const SPOKE_INNER = 34;
const SPOKE_OUTER = 70;

function spokeEnds(index: number) {
  const rad = ((index * STEP - 90) * Math.PI) / 180;
  return {
    x1: 100 + SPOKE_INNER * Math.cos(rad),
    y1: 100 + SPOKE_INNER * Math.sin(rad),
    x2: 100 + SPOKE_OUTER * Math.cos(rad),
    y2: 100 + SPOKE_OUTER * Math.sin(rad),
  };
}

/**
 * The hero centerpiece: six platform chips orbiting a glowing local database.
 * Pure DOM/SVG — no image assets, so it themes itself in light and dark and
 * costs nothing to ship.
 */
export function OrbitCore() {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <Magnet
      padding={120}
      strength={7}
      sx={(theme) => ({
        // Orbit radius drives every chip position (see the chip transform
        // below). Written as explicit breakpoint blocks rather than an sx
        // responsive object — custom properties are not part of sx's known
        // style keys, so the plain-CSS form is the reliable one. Each value
        // tracks 38% of the matching maxWidth so chips sit on the dashed ring.
        '--fb-orbit-r': '116px',
        [theme.breakpoints.up('sm')]: { '--fb-orbit-r': '140px' },
        [theme.breakpoints.up('md')]: { '--fb-orbit-r': '168px' },
        position: 'relative',
        width: 1,
        maxWidth: { xs: 300, sm: 360, md: 440 },
        aspectRatio: '1 / 1',
        mx: 'auto',
      })}
    >
      {/* Sonar halos leaving the core — two offset pulses read as "ingesting". */}
      {[0, 1.7].map((delay) => (
        <MotionBox
          key={delay}
          aria-hidden
          initial={{ scale: 0.55, opacity: 0.4 }}
          animate={{ scale: 1.5, opacity: 0 }}
          transition={{ duration: 3.4, delay, repeat: Infinity, ease: 'easeOut' }}
          sx={(t2) => ({
            position: 'absolute',
            inset: '18%',
            borderRadius: '50%',
            border: `1px solid ${varAlpha(t2.vars.palette.primary.mainChannel, 0.5)}`,
          })}
        />
      ))}

      {/* Rotating layer: spokes + chips turn together. */}
      <MotionBox
        aria-hidden
        animate={{ rotate: 360 }}
        transition={{ duration: SPIN_SECONDS, repeat: Infinity, ease: 'linear' }}
        sx={{ position: 'absolute', inset: 0 }}
      >
        <Box
          component="svg"
          viewBox="0 0 200 200"
          sx={{ position: 'absolute', inset: 0, width: 1, height: 1 }}
        >
          <circle
            cx="100"
            cy="100"
            r={RING_R}
            fill="none"
            stroke={theme.vars.palette.divider}
            strokeWidth="1"
            strokeDasharray="2 7"
          />
          {collectionPlatformRegistry.map((platform, index) => {
            const { x1, y1, x2, y2 } = spokeEnds(index);
            return (
              <motion.line
                key={platform.id}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={theme.vars.palette.primary.main}
                strokeOpacity={0.45}
                strokeWidth="1"
                strokeDasharray="3 6"
                animate={{ strokeDashoffset: [0, 18] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
              />
            );
          })}
        </Box>

        {collectionPlatformRegistry.map((platform, index) => {
          const angle = index * STEP;
          return (
            <Box
              key={platform.id}
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(calc(var(--fb-orbit-r) * -1)) rotate(${-angle}deg)`,
              }}
            >
              {/* Counter-spin at the same rate so glyphs never turn upside down. */}
              <MotionBox
                animate={{ rotate: -360 }}
                transition={{ duration: SPIN_SECONDS, repeat: Infinity, ease: 'linear' }}
                title={t(platform.title)}
                sx={(t2) => ({
                  width: { xs: 42, md: 52 },
                  height: { xs: 42, md: 52 },
                  borderRadius: '30%',
                  display: 'grid',
                  placeItems: 'center',
                  color: 'text.primary',
                  bgcolor: 'background.paper',
                  border: `1px solid ${t2.vars.palette.divider}`,
                  boxShadow: t2.vars.customShadows.z8,
                })}
              >
                <Iconify icon={platform.icon} width={24} />
              </MotionBox>
            </Box>
          );
        })}
      </MotionBox>

      {/* The core: local database, breathing. */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.25,
        }}
      >
        <MotionBox
          animate={{ scale: [1, 1.045, 1] }}
          transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
          sx={(t2) => ({
            width: { xs: 84, md: 100 },
            height: { xs: 84, md: 100 },
            borderRadius: '28%',
            display: 'grid',
            placeItems: 'center',
            color: 'common.white',
            background: `linear-gradient(135deg, ${t2.vars.palette.primary.light} 0%, ${t2.vars.palette.primary.main} 52%, ${t2.vars.palette.secondary.main} 100%)`,
            boxShadow: `0 16px 40px 0 ${varAlpha(t2.vars.palette.primary.mainChannel, 0.4)}`,
          })}
        >
          <Iconify icon="solar:database-bold-duotone" width={44} />
        </MotionBox>

        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'text.secondary',
          }}
        >
          {t('welcome.hero.coreLabel')}
        </Typography>
      </Box>
    </Magnet>
  );
}
