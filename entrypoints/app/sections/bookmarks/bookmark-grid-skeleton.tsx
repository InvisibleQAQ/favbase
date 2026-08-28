import { CardGridSkeleton, CollectionCardSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder in the bookmark card's shape (favicon line + title). */
export function BookmarkGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton header lines={2} />} />;
}
