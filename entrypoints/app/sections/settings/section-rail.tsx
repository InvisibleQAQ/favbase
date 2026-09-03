import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify';

export interface SectionRailItem<T extends string = string> {
  value: T;
  label: string;
  icon: IconifyName;
}

interface SectionRailProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: SectionRailItem<T>[];
  ariaLabel: string;
}

/**
 * Generic secondary-nav rail inside a settings tab: `md+` vertical rail,
 * horizontal on narrow screens. Shared by every tab (AI / 账号连接 / 通用 /
 * 存储) so each gets the same left sidebar; feed it that tab's items.
 *
 * Visuals are the theme's Tabs defaults (Minimal underline indicator in
 * `currentColor`, selected label at `text.primary` semibold) — this component
 * owns orientation and row alignment, nothing else.
 */
export function SectionRail<T extends string>({
  value,
  onChange,
  items,
  ariaLabel,
}: SectionRailProps<T>) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Tabs
      orientation={isCompact ? 'horizontal' : 'vertical'}
      value={value}
      onChange={(_, v) => onChange(v as T)}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        <Tab
          key={item.value}
          value={item.value}
          label={item.label}
          icon={<Iconify icon={item.icon} width={24} />}
          iconPosition="start"
          // Stacked rows need one icon column: MUI centers a Tab's row, which
          // reads as ragged once every row carries an icon. Horizontal keeps
          // MUI's centering.
          sx={{ whiteSpace: 'nowrap', justifyContent: isCompact ? 'center' : 'flex-start' }}
        />
      ))}
    </Tabs>
  );
}
