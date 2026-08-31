import type { ReactNode } from 'react';

import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';

interface SettingsPanelProps {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

/** One semantic section and one surface for the active Settings rail item. */
export function SettingsPanel({ title, description, children }: SettingsPanelProps) {
  return (
    <Card data-slot="settings-panel">
      <CardHeader
        title={title}
        subheader={description}
        slotProps={{ title: { component: 'h2', variant: 'h4' } }}
      />
      <CardContent>{children}</CardContent>
    </Card>
  );
}
