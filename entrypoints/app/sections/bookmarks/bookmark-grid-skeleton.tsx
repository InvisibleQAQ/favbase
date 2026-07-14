import Skeleton from '@mui/material/Skeleton';

import { CardGridSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder matching the compact bookmark card height. */
export function BookmarkGridSkeleton() {
  return <CardGridSkeleton card={<Skeleton variant="rounded" height={96} />} />;
}
