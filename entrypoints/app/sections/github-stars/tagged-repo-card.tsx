import type { TaggedItem } from '@/lib/tagging';
import { narrowGithubMeta, type GithubRepoItem } from '@/lib/github/github-sync-service';
import { RepoCard } from './repo-card';

/**
 * Map a platform-agnostic TaggedItem back to the GithubRepoItem shape RepoCard
 * expects. platformMeta narrowing is delegated to the sync-service (SSOT); this
 * adapter only supplies the envelope fields. The click URL comes from
 * item.originalUrl, never derived.
 */
function toGithubRepoItem(item: TaggedItem): GithubRepoItem {
  return {
    id: item.itemId,
    repoId: item.platformItemId,
    fullName: item.title,
    ownerLogin: item.authorName,
    htmlUrl: item.originalUrl,
    ...narrowGithubMeta(item.platformMeta),
  };
}

/** GitHub card adapter for TaggedItemGrid's renderCard prop. */
export function TaggedRepoCard({
  item,
  onEditTags,
}: {
  item: TaggedItem;
  onEditTags: (anchor: HTMLElement) => void;
}) {
  return <RepoCard repo={toGithubRepoItem(item)} tags={item.tags} onEditTags={onEditTags} />;
}
