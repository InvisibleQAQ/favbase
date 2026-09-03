import { Link as RouterLink } from 'react-router-dom';

import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardHeader from '@mui/material/CardHeader';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';

import type { CollectionAnalyticsSnapshot } from '@/lib/collections';
import { useTranslation } from '@/lib/i18n/use-translation';

import { formatNumber } from './analytics-format';

/**
 * Top tags as drill-down links into `/collections?tag=<uuid>`.
 *
 * The caller renders this card only when there are tags — the zero-tag state
 * is one honest line on the coverage KPI card, not an empty card.
 */
export function AnalyticsTopTags({ tags }: { tags: CollectionAnalyticsSnapshot['topTags'] }) {
  const { t, locale } = useTranslation();

  return (
    <Card>
      <CardHeader
        title={t('dashboard.topTags')}
        slotProps={{ title: { component: 'h2', variant: 'h4' } }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              component={RouterLink}
              to={`/collections?tag=${encodeURIComponent(tag.id)}`}
              clickable
              label={
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'baseline' }}
                >
                  {tag.name}
                  <Typography component="span" variant="caption" sx={{ color: 'text.secondary' }}>
                    {formatNumber(tag.itemCount, locale)}
                  </Typography>
                </Box>
              }
            />
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
