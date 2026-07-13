import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Skeleton from '@mui/material/Skeleton';

import { CardGridSkeleton } from '../../components/collection';

/** Loading placeholder shared by the folder grid and the tag-filtered grid. */
export function VideoGridSkeleton() {
  return (
    <CardGridSkeleton
      card={
        <Card sx={{ overflow: 'hidden' }}>
          <Skeleton variant="rectangular" height={130} />
          <Box sx={{ p: 1.5 }}>
            <Skeleton variant="text" width="80%" />
            <Skeleton variant="text" width="50%" />
          </Box>
        </Card>
      }
    />
  );
}
