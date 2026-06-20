import type { SxProps, Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';

import { varAlpha } from 'minimal-shared/utils';

type Color = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error';

export type StatWidgetProps = {
  sx?: SxProps<Theme>;
  icon: React.ReactNode;
  title: string;
  total: number;
  color?: Color;
};

export function StatWidget({ sx, icon, title, total, color = 'primary' }: StatWidgetProps) {
  return (
    <Card
      sx={[
        (theme) => ({
          p: 3,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          boxShadow: theme.vars.customShadows.card,
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        sx={(theme) => ({
          width: 64,
          height: 64,
          flexShrink: 0,
          display: 'flex',
          borderRadius: '50%',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.vars.palette[color].dark,
          bgcolor: varAlpha(theme.vars.palette[color].mainChannel, 0.08),
          '& > svg': { width: 32, height: 32 },
          '& > img': { width: 36, height: 36 },
        })}
      >
        {icon}
      </Box>

      <Box sx={{ flexGrow: 1 }}>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', mb: 0.5 }}>
          {title}
        </Typography>
        <Typography variant="h4">{total.toLocaleString()}</Typography>
      </Box>
    </Card>
  );
}
