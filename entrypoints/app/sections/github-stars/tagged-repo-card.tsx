import type { TaggedItem } from '@/lib/tagging';
import type { GithubRepoItem } from '@/lib/github/github-sync-service';
import { RepoCard } from './repo-card';

/**
 * Map a platform-agnostic TaggedItem back to the GithubRepoItem shape RepoCard
 * expects. platformMeta was written by github-sync-service with { description,
 * language, stargazersCount, forksCount, topics, pushedAt, starredAt,
 * ownerAvatarUrl }; missing fields get safe defaults (defensive narrowing,
 * mirroring toBiliFavVideo).
 */
function toGithubRepoItem(item: TaggedItem): GithubRepoItem {
  const meta = item.platformMeta;
  return {
    id: item.itemId,
    repoId: item.platformItemId,
    fullName: item.title,
    ownerLogin: item.authorName,
    htmlUrl: item.originalUrl,
    description: typeof meta.description === 'string' ? meta.description : null,
    language: typeof meta.language === 'string' ? meta.language : null,
    stargazersCount: typeof meta.stargazersCount === 'number' ? meta.stargazersCount : 0,
    forksCount: typeof meta.forksCount === 'number' ? meta.forksCount : 0,
    topics: Array.isArray(meta.topics) ? (meta.topics as string[]) : [],
    pushedAt: typeof meta.pushedAt === 'string' ? meta.pushedAt : null,
    starredAt: typeof meta.starredAt === 'string' ? meta.starredAt : null,
    ownerAvatarUrl: typeof meta.ownerAvatarUrl === 'string' ? meta.ownerAvatarUrl : null,
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
