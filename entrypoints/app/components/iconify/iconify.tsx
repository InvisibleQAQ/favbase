import type { IconProps } from '@iconify/react';

import { useId } from 'react';
import { Icon } from '@iconify/react';

import { styled } from '@mui/material/styles';

import { allIconNames, registerIcons } from './register-icons';

import type { IconifyName } from './register-icons';

export type IconifyProps = React.ComponentProps<typeof IconRoot> &
  Omit<IconProps, 'icon'> & {
    icon: IconifyName;
  };

export function Iconify({ className, icon, width = 20, height, sx, ...other }: IconifyProps) {
  const id = useId();

  if (!allIconNames.includes(icon)) {
    console.warn(
      `[favbase] Icon "${icon}" is loaded online. Register it in icon-sets.ts for offline use.`
    );
  }

  registerIcons();

  return (
    <IconRoot
      ssr
      id={id}
      icon={icon}
      className={className}
      sx={[
        {
          width,
          flexShrink: 0,
          height: height ?? width,
          display: 'inline-flex',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...other}
    />
  );
}

const IconRoot = styled(Icon)``;
