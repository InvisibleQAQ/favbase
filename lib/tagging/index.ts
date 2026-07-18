export { resolveTaggingConfig, getTaggingConfig, type ResolvedTaggingConfig } from './config';
export {
  TAGGING_SYSTEM_PROMPT,
  buildTaggingPrompt,
  MAX_TAGS,
  MAX_CONTENT_CHARS,
  MAX_EXISTING_TAGS,
  type TaggingInput,
} from './prompt';
export { generateTags, normalizeTags } from './tagger';
export {
  tagPlatformItem,
  tagNewItems,
  getAllUsedTags,
  getTagsForPlatformItems,
  getItemsByTags,
  addTagToPlatformItem,
  removeTagFromPlatformItem,
  type TagRef,
  type UsedTag,
  type TaggedItem,
  type TagItemResult,
  type TaggingDeps,
} from './tagging-service';
