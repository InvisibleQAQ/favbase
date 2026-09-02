import type { ReactNode } from 'react';

import { EmptyContent } from '../empty-content';

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
 * Dashed empty / error / no-match state shared by every page. A thin adapter
 * over `EmptyContent filled` — this component owns the page-level box (min
 * height, vertical padding, the `data-state-box` handle callers assert on),
 * `EmptyContent` owns the tinted dashed shell and the copy treatment.
 */
export function StateBox({
  icon,
  title,
  description,
  action,
  minHeight = 320,
  children,
}: StateBoxProps) {
  const trailing = action != null || children != null ? (
    <>
      {action}
      {children}
    </>
  ) : undefined;

  return (
    <EmptyContent
      filled
      data-state-box
      icon={icon}
      title={title}
      description={description}
      action={trailing}
      sx={{ minHeight, py: 4 }}
    />
  );
}
