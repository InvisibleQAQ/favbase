import type { CollectionPlatform, ProcessingCoverage } from '@/lib/collections';
import { useTranslation } from '@/lib/i18n/use-translation';

import type { PipelineProgressSegment } from '../components/collection';
import type { BackgroundJob } from './background-jobs-store';
import {
  buildPipelineSegments,
  collectionPipelineStages,
  deriveTaggingBudgetHold,
  type CollectionPipelineContentStage,
  type PipelineRuntimeSnapshot,
  type ProcessingCoverageStatus,
  type TaggingBudgetHold,
} from './pipeline-segments';
import {
  useProcessingCoverage,
  type ProcessingCoverageRefreshKey,
} from './use-processing-coverage';
import { useTaggingBudgetReachedSpend } from './use-tagging-tokens-spent-today';

export interface UseCollectionPipelineInput {
  platform: CollectionPlatform;
  /**
   * Sync in flight. Its settle is the acquisition refresh signal — kept apart
   * from `fetch.running` because a platform may settle the Fetch segment
   * before the sync job ends (github's readme phase).
   */
  syncing: boolean;
  /** Fetch runtime snapshot; platforms pick the progress adapter (`fetchedCountProgress` or default). */
  fetch: PipelineRuntimeSnapshot | null;
  /** Platform content stage between Fetch and Embedding; omitted when the platform has none. */
  content?: CollectionPipelineContentStage | null;
  embedJob: BackgroundJob | null;
  tagJob: BackgroundJob | null;
  /** Extra non-job signals that must re-query coverage (e.g. a content worker's running flag). */
  extraRefreshKey?: ProcessingCoverageRefreshKey;
}

export interface UseCollectionPipelineResult {
  coverage: ProcessingCoverage;
  coverageStatus: ProcessingCoverageStatus;
  segments: PipelineProgressSegment[];
  /** Tags stopped at the user's daily limit with items waiting; feeds `TaggingBudgetNotice`. */
  taggingBudgetHold: TaggingBudgetHold | null;
}

/** Coverage re-query key: sync settle + embed/tag completions, plus whatever the platform appends. */
export function collectionCoverageRefreshKey(
  syncing: boolean,
  embedJob: BackgroundJob | null,
  tagJob: BackgroundJob | null,
  extra?: ProcessingCoverageRefreshKey,
): string {
  const base = `${syncing}:${embedJob?.generation ?? 0}:${tagJob?.generation ?? 0}`;
  return extra === undefined ? base : `${base}:${String(extra)}`;
}

/**
 * One collection page's pipeline: DB coverage (+ its refresh key), the shared
 * `pipeline.*` labels, the standard Fetch → content? → Embedding → Tagging
 * segments and the Tagging Budget hold. Views inject only the platform-shaped parts.
 */
export function useCollectionPipeline({
  platform,
  syncing,
  fetch,
  content,
  embedJob,
  tagJob,
  extraRefreshKey,
}: UseCollectionPipelineInput): UseCollectionPipelineResult {
  const { t } = useTranslation();
  const { coverage, status: coverageStatus } = useProcessingCoverage(
    platform,
    collectionCoverageRefreshKey(syncing, embedJob, tagJob, extraRefreshKey),
  );
  const spentAtCap = useTaggingBudgetReachedSpend();
  const taggingBudgetHold = deriveTaggingBudgetHold(coverage, coverageStatus, spentAtCap);
  const segments = buildPipelineSegments({
    coverage,
    coverageStatus,
    stages: collectionPipelineStages({
      labels: {
        fetch: t('pipeline.fetch'),
        embedding: t('pipeline.embedding'),
        tagging: t('pipeline.tagging'),
      },
      fetch,
      content,
      embedJob,
      tagJob,
      taggingDeferredNote: taggingBudgetHold ? t('pipeline.taggingBudgetReached') : null,
    }),
  });
  return { coverage, coverageStatus, segments, taggingBudgetHold };
}
