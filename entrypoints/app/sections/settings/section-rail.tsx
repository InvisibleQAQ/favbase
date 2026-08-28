import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify';
import { segmentedTabsSx } from './segmented-tabs-sx';

export interface SectionRailItem<T extends string = string> {
  value: T;
  label: string;
  icon: IconifyName;
}

interface SectionRailProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: SectionRailItem<T>[];
}

/**
 * Generic secondary-nav rail inside a settings tab: `md+` vertical rail,
 * horizontal fullWidth on narrow screens. Shared by every tab (AI / 账号连接 /
 * 通用 / 存储) so each gets the same left sidebar; feed it that tab's items.
 * Visual contract lives in `segmented-tabs-sx.ts`, shared with SettingsTabs.
 */
export function SectionRail<T extends string>({ value, onChange, items }: SectionRailProps<T>) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Tabs
      orientation={isCompact ? 'horizontal' : 'vertical'}
      variant={isCompact ? 'fullWidth' : 'standard'}
      value={value}
      onChange={(_, v) => onChange(v as T)}
      sx={(t) => segmentedTabsSx(t, { compact: isCompact, tabMinHeight: 48 })}
    >
      {items.map((item) => (
        <Tab
          key={item.value}
          value={item.value}
          label={item.label}
          icon={<Iconify icon={item.icon} width={22} />}
          iconPosition="start"
        />
      ))}
    </Tabs>
  );
}
