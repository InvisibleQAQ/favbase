import type { LocaleKeys } from './zh-CN';

const en: Record<LocaleKeys, string> = {
  'status.loading': 'Loading subtitles...',
  'status.error': 'Failed to load: {{error}}',
  'status.errorUnknown': 'Unknown error',
  'status.noSubtitle': 'No subtitles detected, transcription available',
  'panel.expand': 'Expand panel',
  'panel.collapse': 'Collapse panel',

  'subtitle.jumpTo': 'Jump to {{time}}',

  'search.placeholder': 'Search subtitles...',
  'search.clear': 'Clear',
  'search.noResults': 'No matching subtitles',

  'source.bilibili': 'Official AI',
  'source.groqCached': 'ASR Cached',
  'source.groq': 'ASR Transcribed',

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

  'transcribe.button': 'Start Transcription',
  'transcribe.cancel': 'Cancel',
  'transcribe.retry': 'Retry',
  'transcribe.noApiKey': 'Please configure Groq API Key in Settings',
  'transcribe.progress': 'Transcribing {{progress}}%',
  'transcribe.rateLimit': 'Rate limited, retry in {{seconds}}s',

  'stage.start': 'Starting transcription',
  'stage.connectivity': 'Checking Groq connectivity',
  'stage.extracting': 'Extracting audio URL',
  'stage.downloading': 'Downloading audio',
  'stage.uploading': 'Uploading to Groq',
  'stage.transcribing': 'Transcribing',
  'stage.chunking': 'Preparing chunks (FFmpeg)',
  'stage.chunk_transcribing': 'Chunk {{current}}/{{total}}',
  'stage.processing': 'Processing subtitles',
  'stage.done': 'Transcription complete',
  'stage.cancelled': 'Cancelled',
  'stage.failed': 'Transcription failed',

  'error.ASR_REQUEST_TIMEOUT': 'Operation cancelled',
  'error.ASR_RATE_LIMIT': 'Groq rate limited',
  'error.ASR_GROQ_UNREACHABLE': 'Cannot reach Groq API, check your network',
  'error.ASR_GROQ_ACCESS_BLOCKED': 'Groq API access blocked',
  'error.ASR_INVALID_KEY': 'Invalid Groq API Key',
  'error.ASR_FILE_TOO_LARGE': 'Audio file too large',
  'error.ASR_CHUNKING_FAILED': 'FFmpeg chunking failed',
  'error.ASR_CHUNKING_UNSUPPORTED': 'Audio still exceeds size limit after chunking',
  'error.ASR_CHUNK_DURATION_UNKNOWN': 'Cannot determine audio duration',
  'error.ASR_AUDIO_REUSED': 'Audio fingerprint collision, likely stale navigation data',
  'error.ASR_AUDIO_BVID_MISMATCH': 'Audio does not match video',
  'error.ASR_NO_AUDIO_SOURCE': 'No audio track found',
  'error.DOWNLOAD_FAILED': 'Audio download failed (HTTP {{status}})',
  'error.ASR_UNKNOWN': 'Unknown error: {{detail}}',
};

export default en;
