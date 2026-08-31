import { CardGridSkeleton, CollectionCardSkeleton } from '../../components/collection';

/** Loading placeholder shared by the folder grid and the tag-filtered grid:
 *  the video card's shape (16:9 cover + title + uploader line). */
export function VideoGridSkeleton() {
  return <CardGridSkeleton card={<CollectionCardSkeleton media="16/9" lines={2} />} />;
}
