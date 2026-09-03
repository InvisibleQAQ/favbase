import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';

/** Same grid as the loaded page: four KPI cards, then composition | detail. */
export function AnalyticsLoading({ label }: { label: string }) {
  return (
    <Box role="status" aria-busy="true" aria-label={label}>
      <Grid container spacing={3}>
        {[0, 1, 2, 3].map((key) => (
          <Grid key={key} size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ p: 3, height: 1, boxShadow: 'none' }}>
              <Skeleton variant="text" width={112} />
              <Skeleton variant="text" width={72} height={30} sx={{ mt: 1 }} />
            </Card>
          </Grid>
        ))}

        <Grid size={{ xs: 12, md: 6, lg: 4 }}>
          <Card sx={{ height: 1 }}>
            <CardContent>
              <Skeleton variant="text" width={140} height={26} sx={{ mb: 3 }} />
              <Skeleton variant="circular" width={200} height={200} sx={{ mx: 'auto' }} />
              <Box sx={{ mt: 3 }}>
                {[0, 1, 2, 3, 4, 5].map((key) => (
                  <Box
                    key={key}
                    sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, minHeight: 44 }}
                  >
                    <Skeleton variant="circular" width={12} height={12} />
                    <Skeleton variant="text" sx={{ flex: 1 }} />
                    <Skeleton variant="text" width={32} />
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 8 }}>
          <Card sx={{ height: 1 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
                <Skeleton variant="rounded" width={48} height={48} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width={200} height={26} />
                  <Skeleton variant="text" width={100} />
                </Box>
              </Box>
              <Grid container spacing={{ xs: 3, md: 5 }}>
                {[0, 1].map((column) => (
                  <Grid key={column} size={{ xs: 12, lg: 6 }}>
                    <Skeleton variant="text" width={140} sx={{ mb: 1 }} />
                    {[0, 1, 2, 3, 4].map((key) => (
                      <Skeleton key={key} variant="text" height={36} />
                    ))}
                  </Grid>
                ))}
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}
