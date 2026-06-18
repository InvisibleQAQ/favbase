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

  'sidebar.subtitles': 'Subtitles',
  'sidebar.settings': 'Settings',

  'settings.llm': 'LLM Settings',
  'settings.llmProvider': 'LLM Provider',
  'settings.apiKey': 'API Key',
  'settings.apiKeyPlaceholder': 'Enter API Key',
  'settings.model': 'Model',
  'settings.modelPlaceholder': 'Enter model name',
  'settings.getKey': 'Get Key',
  'settings.customBaseUrl': 'Custom Base URL',
  'settings.customBaseUrlPlaceholder': 'https://your-endpoint.com/v1/',
  'settings.customProtocol': 'Protocol',

  'settings.asr': 'ASR Settings',
  'settings.asrProvider': 'ASR Provider',

  'settings.mode': 'Call Mode',
  'settings.modeQuality': 'Quality',
  'settings.modeQualityDesc': 'Two parallel requests, more accurate results',
  'settings.modeEfficiency': 'Efficiency',
  'settings.modeEfficiencyDesc': 'Single merged request, faster speed',

  'settings.saved': 'Saved',
  'settings.show': 'Show',
  'settings.hide': 'Hide',

  'transcribe.button': 'Transcribe',
  'transcribe.cancel': 'Cancel',
  'transcribe.retry': 'Retry',
  'transcribe.noApiKey': 'Please configure Groq API Key in Settings',
  'transcribe.progress': 'Transcribing {{progress}}%',
  'transcribe.cached': '{{count}} subtitles (Groq cached)',
  'transcribe.done': '{{count}} subtitles (Groq ASR)',
  'transcribe.rateLimit': 'Rate limited, retry in {{seconds}}s',
};

export default en;
