import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Grid from '@mui/material/Grid';
import Pagination from '@mui/material/Pagination';

/** 1 / 2 / 3 / 4 cards per row across breakpoints — the single source of truth. */
export const CARD_GRID_SIZE = { xs: 12, sm: 6, md: 4, lg: 3 } as const;

/** 24px gutter — the same unit as the content gutter and the Dashboard grid. */
export const CARD_GRID_SPACING = 3;

export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <Grid container spacing={CARD_GRID_SPACING}>
      {children}
    </Grid>
  );
}

export function CardGridItem({ children }: { children: ReactNode }) {
  return <Grid size={CARD_GRID_SIZE}>{children}</Grid>;
}

export interface CardGridPaginationProps {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}

/** Centered pagination below the grid; renders nothing for a single page. */
export function CardGridPagination({ page, totalPages, onChange }: CardGridPaginationProps) {
  if (totalPages <= 1) return null;
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
      <Pagination
        count={totalPages}
        page={page}
        onChange={(_, value) => onChange(value)}
        color="primary"
        shape="rounded"
      />
    </Box>
  );
}

/** Grid-of-8 loading placeholder on the real grid track; each platform
 *  supplies its card shape (normally a `CollectionCardSkeleton`). */
export function CardGridSkeleton({ card }: { card: ReactNode }) {
  return (
    <CardGrid>
      {Array.from({ length: 8 }).map((_, i) => (
        <CardGridItem key={i}>{card}</CardGridItem>
      ))}
    </CardGrid>
  );
}
