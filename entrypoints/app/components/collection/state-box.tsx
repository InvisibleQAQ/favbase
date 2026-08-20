import type { ReactNode } from 'react';
import { varAlpha } from 'minimal-shared/utils';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface StateBoxProps {
  /** Leading visual, e.g. an <Iconify width={64}> — caller controls color/margin. */
  icon?: ReactNode;
  /** Wrapped in an h6 Typography. For custom title styling use `children` instead. */
  title?: ReactNode;
  /** Wrapped in a centered secondary body2 Typography (maxWidth 400). */
  description?: ReactNode;
  /** Action slot, e.g. a retry Button — caller controls variant/loading state. */
  action?: ReactNode;
  minHeight?: number;
  /** Escape hatch for non-standard content (plain text states etc.). */
  children?: ReactNode;
}

/** Dashed empty/error state box shared by all platform sections. */
export function StateBox({
  icon,
  title,
  description,
  action,
  minHeight = 320,
  children,
}: StateBoxProps) {
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight,
        gap: 2,
        borderRadius: 3,
        border: `2px dashed ${varAlpha(theme.vars.palette.grey['500Channel'], 0.24)}`,
        p: 4,
      })}
    >
      {icon}
      {title != null && <Typography variant="h6">{title}</Typography>}
      {description != null && (
        <Typography
          variant="body2"
          sx={{ color: 'text.secondary', textAlign: 'center', maxWidth: 400 }}
        >
          {description}
        </Typography>
      )}
      {action}
      {children}
    </Box>
  );
}
