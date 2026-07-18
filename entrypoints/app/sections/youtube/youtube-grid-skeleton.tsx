import Card from '@mui/material/Card';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';

import { CardGridSkeleton } from '../../components/collection';

/** Grid-of-8 loading skeleton matching the YouTube card shape (16:9 media + text). */
export function YoutubeGridSkeleton() {
  return (
    <CardGridSkeleton
      card={
        <Card>
          <Skeleton variant="rectangular" sx={{ aspectRatio: '16 / 9', height: 'auto' }} />
          <Box sx={{ p: 1.5 }}>
            <Skeleton width="90%" />
            <Skeleton width="55%" />
          </Box>
        </Card>
      }
    />
  );
}
