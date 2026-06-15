import type { LocaleKeys } from './zh-CN';

const en: Record<LocaleKeys, string> = {
  'status.loading': 'Loading subtitles...',
  'status.error': 'Failed to load: {{error}}',
  'status.errorUnknown': 'Unknown error',
  'status.noSubtitle': 'No AI subtitles for this video',
  'status.count': '{{count}} subtitles (Bilibili AI)',

  'panel.expand': 'Expand panel',
  'panel.collapse': 'Collapse panel',

  'subtitle.jumpTo': 'Jump to {{time}}',
};

export default en;
