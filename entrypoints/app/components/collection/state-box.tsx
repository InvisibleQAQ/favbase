import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

export interface StateBoxProps {
  /** Leading visual, e.g. an <Iconify width={48}> — caller controls color. */
  icon?: ReactNode;
  /** Wrapped in a subtitle1 paragraph (not a heading: one page, one h1). For
   *  custom title styling use `children` instead. */
  title?: ReactNode;
  /** Wrapped in a centered secondary body2 Typography (maxWidth 400). */
  description?: ReactNode;
  /** Action slot, e.g. a retry Button — caller controls variant/loading state. */
  action?: ReactNode;
  minHeight?: number;
  /** Escape hatch for non-standard content (plain text states etc.). */
  children?: ReactNode;
}

/**
 * Dashed empty / error / no-match state shared by every page. One density for
 * all of them: hairline dashed divider, centered column, 16px gaps. The copy
 * says what happened; the action says how to recover.
 */
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
      data-state-box
      sx={(theme) => ({
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight,
        gap: 2,
        borderRadius: 1,
        border: `1px dashed ${theme.vars.palette.divider}`,
        p: 4,
      })}
    >
      {icon}
      {title != null && <Typography variant="subtitle1">{title}</Typography>}
      {description != null && (
        <Typography variant="body2" sx={{ color: 'text.secondary', maxWidth: 400 }}>
          {description}
        </Typography>
      )}
      {action}
      {children}
    </Box>
  );
}
