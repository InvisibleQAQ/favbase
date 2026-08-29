import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify';
import { segmentedTabsSx } from './segmented-tabs-sx';

export interface SettingsTabItem {
  value: string;
  label: string;
  icon: IconifyName;
}

interface SettingsTabsProps {
  value: string;
  onChange: (value: string) => void;
  tabs: SettingsTabItem[];
  ariaLabel: string;
}

export function SettingsTabs({ value, onChange, tabs, ariaLabel }: SettingsTabsProps) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Tabs
      value={value}
      onChange={(_, v) => onChange(v)}
      variant={isCompact ? 'scrollable' : 'fullWidth'}
      scrollButtons={false}
      aria-label={ariaLabel}
      sx={(theme) => ({
        minHeight: 48,
        ...segmentedTabsSx(theme, { compact: true }),
        '& .MuiTabs-scroller': { scrollbarWidth: 'none' },
        '& .MuiTabs-scroller::-webkit-scrollbar': { display: 'none' },
      })}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          icon={<Iconify icon={tab.icon} width={20} />}
          iconPosition="start"
          sx={{ whiteSpace: 'nowrap', minWidth: { xs: 112, md: 0 } }}
        />
      ))}
    </Tabs>
  );
}
