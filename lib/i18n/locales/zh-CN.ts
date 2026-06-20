const zhCN = {
  'status.loading': '正在加载字幕...',
  'status.error': '加载失败: {{error}}',
  'status.errorUnknown': '未知错误',
  'status.noSubtitle': '未检测到字幕，可开启在线转录',
  'panel.expand': '展开面板',
  'panel.collapse': '收起面板',

  'subtitle.jumpTo': '跳转到 {{time}}',

  'search.placeholder': '搜索字幕...',
  'search.clear': '清空',
  'search.noResults': '未找到匹配的字幕',

  'source.bilibili': '官方AI字幕',
  'source.groqCached': 'ASR 缓存',
  'source.groq': 'ASR 转录',

  'sidebar.subtitles': '字幕',
  'sidebar.settings': '设置',

  'settings.llm': 'LLM 设置',
  'settings.llmProvider': 'LLM 服务商',
  'settings.apiKey': 'API Key',
  'settings.apiKeyPlaceholder': '输入 API Key',
  'settings.model': '模型',
  'settings.modelPlaceholder': '输入模型名称',
  'settings.getKey': '获取密钥',
  'settings.customBaseUrl': '自定义 Base URL',
  'settings.customBaseUrlPlaceholder': 'https://your-endpoint.com/v1/',
  'settings.customProtocol': '协议',

  'settings.asr': 'ASR 设置',
  'settings.asrProvider': 'ASR 服务商',

  'settings.mode': '调用模式',
  'settings.modeQuality': '质量优先',
  'settings.modeQualityDesc': '两次独立请求并行，结果更准确',
  'settings.modeEfficiency': '效率优先',
  'settings.modeEfficiencyDesc': '单次请求合并，速度更快',

  'settings.saved': '已保存',
  'settings.show': '显示',
  'settings.hide': '隐藏',

  'transcribe.button': '开始在线转录',
  'transcribe.cancel': '取消转录',
  'transcribe.retry': '重试',
  'transcribe.noApiKey': '请先在设置中配置 Groq API Key',
  'transcribe.progress': '转录中 {{progress}}%',
  'transcribe.rateLimit': 'Groq 速率限制，{{seconds}}s 后重试',

  'stage.start': '开始转录',
  'stage.connectivity': '检查 Groq 连通性',
  'stage.extracting': '提取音频地址',
  'stage.downloading': '下载音频',
  'stage.uploading': '上传音频到 Groq',
  'stage.transcribing': '转录中',
  'stage.chunking': '准备分块 (FFmpeg)',
  'stage.chunk_transcribing': '分块转录 {{current}}/{{total}}',
  'stage.processing': '处理字幕',
  'stage.done': '转录完成',
  'stage.cancelled': '已取消',
  'stage.failed': '转录失败',

  'error.ASR_REQUEST_TIMEOUT': '操作已取消',
  'error.ASR_RATE_LIMIT': 'Groq 速率限制',
  'error.ASR_GROQ_UNREACHABLE': '无法连接 Groq API，请检查网络',
  'error.ASR_GROQ_ACCESS_BLOCKED': 'Groq API 访问被封禁',
  'error.ASR_INVALID_KEY': 'Groq API Key 无效',
  'error.ASR_FILE_TOO_LARGE': '音频文件过大',
  'error.ASR_CHUNKING_FAILED': 'FFmpeg 分块失败',
  'error.ASR_CHUNKING_UNSUPPORTED': '音频分块后仍超过大小限制',
  'error.ASR_CHUNK_DURATION_UNKNOWN': '无法确定音频时长',
  'error.ASR_AUDIO_REUSED': '音频指纹重复，可能是页面导航残留',
  'error.ASR_AUDIO_BVID_MISMATCH': '音频与视频不匹配',
  'error.ASR_NO_AUDIO_SOURCE': '未提取到音轨地址',
  'error.DOWNLOAD_FAILED': '音频下载失败 (HTTP {{status}})',
  'error.ASR_UNKNOWN': '未知错误: {{detail}}',
} as const;

export type LocaleKeys = keyof typeof zhCN;
export default zhCN;
