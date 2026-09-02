import type { ReactNode, ComponentProps } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';
import type { LinearProgressProps } from '@mui/material/LinearProgress';

import Portal from '@mui/material/Portal';
import { styled } from '@mui/material/styles';
import LinearProgress from '@mui/material/LinearProgress';

export type LoadingScreenProps = ComponentProps<'div'> & {
  portal?: boolean;
  sx?: SxProps<Theme>;
  slots?: {
    progress?: ReactNode;
  };
  slotProps?: {
    progress?: LinearProgressProps;
  };
};

/**
 * Route-level pending state: a centered indeterminate bar that fills whatever
 * box it is dropped into. Used as the router's Suspense fallback.
 *
 * Minimal's `loading-screen/` also exports a logo splash screen; we do not
 * port it — app.html has no full-page boot screen.
 */
export function LoadingScreen({ portal, slots, slotProps, sx, ...other }: LoadingScreenProps) {
  const renderContent = () => (
    <LoadingContent sx={sx} {...other}>
      {slots?.progress ?? (
        <LinearProgress
          color="inherit"
          {...slotProps?.progress}
          sx={[
            { width: 1, maxWidth: 360 },
            ...(Array.isArray(slotProps?.progress?.sx)
              ? slotProps.progress.sx
              : [slotProps?.progress?.sx]),
          ]}
        />
      )}
    </LoadingContent>
  );

  if (portal) {
    return <Portal>{renderContent()}</Portal>;
  }

  return renderContent();
}

const LoadingContent = styled('div')(({ theme }) => ({
  flexGrow: 1,
  width: '100%',
  display: 'flex',
  minHeight: '100%',
  alignItems: 'center',
  justifyContent: 'center',
  paddingLeft: theme.spacing(5),
  paddingRight: theme.spacing(5),
}));
