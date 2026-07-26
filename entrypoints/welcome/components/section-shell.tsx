import type { ReactNode } from 'react';
import type { BoxProps } from '@mui/material/Box';

import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { Iconify, type IconifyName } from '@/entrypoints/app/components/iconify';

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
        { position: 'relative', py: { xs: 10, md: 16 } },
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
 * Oversized display headline with the page's gradient fill (`.fb-headline`,
 * see welcome.css). `hero` is the first-screen size; `section` is every band
 * below it.
 */
export function Headline({
  children,
  size = 'section',
  sx,
}: {
  children: ReactNode;
  size?: 'hero' | 'section';
  sx?: BoxProps['sx'];
}) {
  return (
    <Box
      className="fb-headline"
      sx={[
        (theme) => ({
          fontFamily: theme.typography.fontSecondaryFamily,
          fontWeight: 800,
          lineHeight: 0.98,
          letterSpacing: '-0.03em',
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
    </Box>
  );
}
