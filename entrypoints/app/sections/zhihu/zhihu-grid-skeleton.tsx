import { CardGridSkeleton, CollectionCardSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder in the zhihu card's shape (author line + title + excerpt). */
export function ZhihuGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton header lines={3} />} />;
}
