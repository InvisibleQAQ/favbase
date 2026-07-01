import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import { varAlpha } from 'minimal-shared/utils';

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
}

export function SettingsTabs({ value, onChange, tabs }: SettingsTabsProps) {
  return (
    <Tabs
      value={value}
      onChange={(_, v) => onChange(v)}
      variant="fullWidth"
      sx={(theme) => ({
        minHeight: 48,
        p: 0.5,
        borderRadius: 2,
        bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
        '& .MuiTabs-indicator': { display: 'none' },
        '& .MuiTabs-flexContainer': { gap: 0.5 },
        '& .MuiTab-root': {
          minHeight: 40,
          borderRadius: 1.5,
          fontWeight: theme.typography.fontWeightMedium,
          color: theme.vars.palette.text.secondary,
          transition: theme.transitions.create(['color', 'background-color', 'box-shadow']),
          '&:hover': { color: theme.vars.palette.text.primary },
          '&.Mui-selected': {
            color: theme.vars.palette.text.primary,
            bgcolor: theme.vars.palette.background.paper,
            boxShadow: theme.vars.customShadows.z1,
          },
        },
      })}
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
