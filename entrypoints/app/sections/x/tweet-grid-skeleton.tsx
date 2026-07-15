import Skeleton from '@mui/material/Skeleton';

import { CardGridSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder matching the tweet card height. */
export function TweetGridSkeleton() {
  return <CardGridSkeleton card={<Skeleton variant="rounded" height={200} />} />;
}
