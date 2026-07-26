import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { varAlpha } from 'minimal-shared/utils';

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
}

/**
 * Generic secondary-nav rail inside a settings tab: `md+` vertical rail,
 * horizontal fullWidth on narrow screens. Shared by every tab (AI / 账号连接 /
 * 通用 / 存储) so each gets the same left sidebar; feed it that tab's items.
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
      sx={(t) => ({
        p: 0.5,
        borderRadius: 2,
        bgcolor: varAlpha(t.vars.palette.grey['500Channel'], 0.08),
        '& .MuiTabs-indicator': { display: 'none' },
        '& .MuiTabs-flexContainer': { gap: 0.5 },
        '& .MuiTab-root': {
          minHeight: 44,
          borderRadius: 1.5,
          justifyContent: isCompact ? 'center' : 'flex-start',
          fontWeight: t.typography.fontWeightMedium,
          color: t.vars.palette.text.secondary,
          transition: t.transitions.create(['color', 'background-color', 'box-shadow']),
          '&:hover': { color: t.vars.palette.text.primary },
          '&.Mui-selected': {
            color: t.vars.palette.primary.main,
            bgcolor: varAlpha(t.vars.palette.primary.mainChannel, 0.08),
            boxShadow: t.vars.customShadows.z1,
          },
        },
      })}
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
