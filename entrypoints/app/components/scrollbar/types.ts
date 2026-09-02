import type { ComponentProps } from 'react';
import type { Theme, SxProps } from '@mui/material/styles';
import type { Props as SimplebarProps } from 'simplebar-react';

export type ScrollbarProps = SimplebarProps &
  ComponentProps<'div'> & {
    sx?: SxProps<Theme>;
    /** Let the content stretch to fill the track. On by default. */
    fillContent?: boolean;
    slotProps?: {
      wrapperSx?: SxProps<Theme>;
      contentSx?: SxProps<Theme>;
      contentWrapperSx?: SxProps<Theme>;
    };
  };
