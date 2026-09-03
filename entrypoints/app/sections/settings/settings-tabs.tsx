import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify';

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

/**
 * Settings top-level tabs — Minimal's underline form, straight off the theme
 * defaults (`scrollable`, `textColor`/`indicatorColor: 'inherit'`, 40px list
 * gap). No local variant switch: one track at every width, horizontally
 * scrollable when four localized labels outgrow it.
 */
export function SettingsTabs({ value, onChange, tabs, ariaLabel }: SettingsTabsProps) {
  return (
    <Tabs
      value={value}
      onChange={(_, v) => onChange(v)}
      aria-label={ariaLabel}
      sx={{ mb: { xs: 3, md: 5 } }}
    >
      {tabs.map((tab) => (
        <Tab
          key={tab.value}
          value={tab.value}
          label={tab.label}
          icon={<Iconify icon={tab.icon} width={24} />}
          iconPosition="start"
          // Long en labels ("Account connections") must overflow into a scroll,
          // never wrap onto a second line.
          sx={{ whiteSpace: 'nowrap' }}
        />
      ))}
    </Tabs>
  );
}
