import { CardGridSkeleton, CollectionCardSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder in the tweet card's shape (author line + 3 text lines). */
export function TweetGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton header lines={3} />} />;
}
