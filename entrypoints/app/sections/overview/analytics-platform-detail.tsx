import { Link as RouterLink } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Grid from '@mui/material/Grid';
import Typography from '@mui/material/Typography';

import type { CollectionAnalyticsPlatform, CollectionPlatform } from '@/lib/collections';
import { useTranslation } from '@/lib/i18n/use-translation';

import { collectionPlatformById } from '../../collection-platform-registry';
import { StateBox } from '../../components/collection';
import { Iconify } from '../../components/iconify';
import type { IconifyName } from '../../components/iconify/register-icons';
import { AnalyticsDimensionRanking } from './analytics-dimension-ranking';
import { formatNumber } from './analytics-format';

/**
 * Neutral square holding a platform glyph. Identity = the platform's brand
 * color on the glyph (`palette.platform`, black-logo brands resolve to ink
 * there); the tile never carries selection — coral owns that.
 */
function PlatformTile({ platform, icon }: { platform: CollectionPlatform; icon: IconifyName }) {
  return (
    <Box
      component="span"
      aria-hidden="true"
      sx={(theme) => ({
        width: 48,
        height: 48,
        flexShrink: 0,
        borderRadius: 0.75,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.neutral',
        color: theme.vars.palette.platform[platform],
      })}
    >
      <Iconify icon={icon} width={28} />
    </Box>
  );
}

/**
 * Detail card for the platform selected in the composition legend. Stays the
 * `tabpanel` of that `tablist` — the two live in sibling cards, which ARIA
 * allows since the wiring is by id.
 */
export function AnalyticsPlatformDetail({
  platform,
}: {
  platform: CollectionAnalyticsPlatform;
}) {
  const { t, locale } = useTranslation();
  const config = collectionPlatformById.get(platform.platform)!;
  const populatedDimensions = platform.dimensions.filter(
    (dimension) => dimension.entries.length > 0,
  );

  return (
    <Card
      role="tabpanel"
      id={`dashboard-platform-panel-${platform.platform}`}
      aria-labelledby={`dashboard-platform-tab-${platform.platform}`}
      sx={{ height: 1 }}
    >
      <CardHeader
        avatar={<PlatformTile platform={platform.platform} icon={config.icon} />}
        title={t(config.title)}
        subheader={t('dashboard.itemCount', {
          count: platform.itemCount,
          value: formatNumber(platform.itemCount, locale),
        })}
        action={
          <Button component={RouterLink} to={config.path} variant="outlined">
            {t('dashboard.openPlatform')}
          </Button>
        }
        slotProps={{
          title: { component: 'h2', variant: 'h4', sx: { overflowWrap: 'anywhere' } },
        }}
      />
      <CardContent>
        {platform.itemCount === 0 ? (
          <StateBox
            minHeight={200}
            icon={<Iconify icon={config.icon} width={48} sx={{ color: 'text.secondary' }} />}
            description={t('dashboard.platformEmpty')}
          />
        ) : populatedDimensions.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', py: 3 }}>
            {t('dashboard.noDimensionData')}
          </Typography>
        ) : (
          <Grid container spacing={{ xs: 3, md: 5 }}>
            {populatedDimensions.map((dimension) => (
              <Grid key={dimension.kind} size={{ xs: 12, lg: 6 }}>
                <AnalyticsDimensionRanking dimension={dimension} />
              </Grid>
            ))}
          </Grid>
        )}
      </CardContent>
    </Card>
  );
}
