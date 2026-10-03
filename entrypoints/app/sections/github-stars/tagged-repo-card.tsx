import { toGithubRepoItem } from '@/lib/github/github-sync-service';
import { taggedCard } from '../../components/tags';
import { RepoCard } from './repo-card';

/** GitHub card adapter for TaggedItemGrid's renderCard prop. */
export const TaggedRepoCard = taggedCard(RepoCard, 'repo', toGithubRepoItem);
