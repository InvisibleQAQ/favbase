import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

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
}

export function SettingsTabs({ value, onChange, tabs }: SettingsTabsProps) {
  return (
    <Tabs
      value={value}
      onChange={(_, v) => onChange(v)}
      variant="fullWidth"
      sx={(theme) => ({ minHeight: 48, ...segmentedTabsSx(theme, { compact: true }) })}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          icon={<Iconify icon={tab.icon} width={20} />}
          iconPosition="start"
        />
      ))}
    </Tabs>
  );
}
