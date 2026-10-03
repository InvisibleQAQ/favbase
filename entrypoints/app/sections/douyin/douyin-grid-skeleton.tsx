import { CardGridSkeleton, CollectionCardSkeleton } from '../../components/collection';

/** Grid-of-8 loading placeholder in the Douyin card's shape (16:9 cover + author line + title). */
export function DouyinGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton media="16/9" header lines={2} />} />;
}
