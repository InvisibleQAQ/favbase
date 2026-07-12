import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Grid from '@mui/material/Grid';
import Skeleton from '@mui/material/Skeleton';

/** Loading placeholder shared by the folder grid and the tag-filtered grid. */
export function VideoGridSkeleton() {
  return (
    <Grid container spacing={2.5}>
      {Array.from({ length: 8 }).map((_, i) => (
        <Grid key={i} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
          <Card sx={{ overflow: 'hidden' }}>
            <Skeleton variant="rectangular" height={130} />
            <Box sx={{ p: 1.5 }}>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="50%" />
            </Box>
          </Card>
        </Grid>
      ))}
    </Grid>
  );
}
