import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Divider from '@mui/material/Divider';
import Tab from '@mui/material/Tab';
import Tabs, { tabsClasses } from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import { useTheme } from '@mui/material/styles';
import { varAlpha } from 'minimal-shared/utils';

import type { CollectionAnalyticsPlatform, CollectionPlatform } from '@/lib/collections';
import { useTranslation } from '@/lib/i18n/use-translation';

import { collectionPlatformById } from '../../collection-platform-registry';
import { ChartLegendItem, DonutChart } from '../../components/chart';
import { formatNumber, formatShare } from './analytics-format';

export interface AnalyticsPlatformCompositionProps {
  platforms: CollectionAnalyticsPlatform[];
  /** Printed in the ring's hole; the same figure as the first KPI card. */
  totalItems: number;
  selectedPlatform: CollectionPlatform;
  selectPlatform: (platform: CollectionPlatform) => void;
}

/**
 * Platform composition: the ring on top, its legend below — and the legend is
 * also the detail selector, so the rows stay `Tab`s inside a vertical `Tabs`
 * (`role="tablist"`, `aria-controls` → the detail card's `tabpanel`).
 *
 * Minimal's `AnalyticsCurrentVisits` stacks chart over legend for the same
 * reason we do: at `lg` this card is 4/12, which leaves ~220px inside the
 * padding — too narrow to put a ring beside six labelled rows.
 */
export function AnalyticsPlatformComposition({
  platforms,
  totalItems,
  selectedPlatform,
  selectPlatform,
}: AnalyticsPlatformCompositionProps) {
  const { t, locale } = useTranslation();
  const theme = useTheme();

  return (
    <Card sx={{ height: 1 }}>
      <CardHeader
        title={t('dashboard.platformComposition')}
        slotProps={{ title: { component: 'h2', variant: 'h4' } }}
      />
      <CardContent>
        <DonutChart
          segments={platforms.map((platform) => ({
            id: platform.platform,
            share: platform.share,
            color: theme.vars.palette.platform[platform.platform],
          }))}
          trackColor={theme.vars.palette.background.neutral}
          center={
            <Box component="span" sx={{ typography: 'h3' }}>
              {formatNumber(totalItems, locale)}
            </Box>
          }
        />

        <Divider sx={{ my: 3, borderStyle: 'dashed' }} />

        <Tabs
          orientation="vertical"
          value={selectedPlatform}
          onChange={(_event, value: CollectionPlatform) => selectPlatform(value)}
          aria-label={t('dashboard.platformDetails')}
          sx={{
            [`& .${tabsClasses.indicator}`]: { display: 'none' },
            // `list`, not the pre-v6 `flexContainer`: MUI 9 renamed the slot and
            // dropped the old class, so a `flexContainer` rule is dead CSS.
            [`& .${tabsClasses.list}`]: { gap: 0.5 },
          }}
        >
          {platforms.map((platform) => {
            const selected = platform.platform === selectedPlatform;
            const title = t(collectionPlatformById.get(platform.platform)!.title);
            return (
              <Tab
                key={platform.platform}
                id={`dashboard-platform-tab-${platform.platform}`}
                aria-controls={
                  selected ? `dashboard-platform-panel-${platform.platform}` : undefined
                }
                value={platform.platform}
                label={
                  <ChartLegendItem
                    color={theme.vars.palette.platform[platform.platform]}
                    label={title}
                    value={formatNumber(platform.itemCount, locale)}
                    selected={selected}
                    aside={
                      <Typography
                        component="span"
                        variant="caption"
                        data-slot="share-label"
                        sx={{ color: 'text.primary', minWidth: 40, textAlign: 'right' }}
                      >
                        {formatShare(platform.share, locale)}
                      </Typography>
                    }
                  />
                }
                sx={{
                  px: 1.5,
                  py: 1,
                  minHeight: 44,
                  maxWidth: 'none',
                  textAlign: 'left',
                  alignItems: 'stretch',
                  borderRadius: 0.75,
                  '&:hover': { bgcolor: 'action.hover' },
                  // Selection = 8% brand wash on the row; the swatch keeps the
                  // platform color so it still matches its arc.
                  '&.Mui-selected': {
                    bgcolor: varAlpha(theme.vars.palette.primary.mainChannel, 0.08),
                  },
                }}
              />
            );
          })}
        </Tabs>
      </CardContent>
    </Card>
  );
}
