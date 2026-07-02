import Tabs from '@mui/material/Tabs';
import Tab from '@mui/material/Tab';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { varAlpha } from 'minimal-shared/utils';

import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify';

export type AiSection = 'llm' | 'asr' | 'embedding';

export interface AiConfigNavItem {
  value: AiSection;
  label: string;
  icon: IconifyName;
}

interface AiConfigNavProps {
  value: AiSection;
  onChange: (value: AiSection) => void;
  items: AiConfigNavItem[];
}

export function AiConfigNav({ value, onChange, items }: AiConfigNavProps) {
  const theme = useTheme();
  const isCompact = useMediaQuery(theme.breakpoints.down('md'));

  return (
    <Tabs
      orientation={isCompact ? 'horizontal' : 'vertical'}
      variant={isCompact ? 'fullWidth' : 'standard'}
      value={value}
      onChange={(_, v) => onChange(v as AiSection)}
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
