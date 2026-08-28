import { CardGridSkeleton, CollectionCardSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder in the YouTube card's shape (16:9 cover + title + channel). */
export function YoutubeGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton media="16/9" lines={2} />} />;
}
