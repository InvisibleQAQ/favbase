const zhCN = {
  'status.loading': '正在加载字幕...',
  'status.error': '加载失败: {{error}}',
  'status.errorUnknown': '未知错误',
  'status.noSubtitle': '未检测到字幕，可开启在线转录',
  'status.count': '共 {{count}} 条字幕 (B站 AI)',

  'panel.expand': '展开面板',
  'panel.collapse': '收起面板',

  'subtitle.jumpTo': '跳转到 {{time}}',

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
  'transcribe.cached': '共 {{count}} 条字幕 (Groq 缓存)',
  'transcribe.done': '共 {{count}} 条字幕 (Groq ASR)',
  'transcribe.rateLimit': 'Groq 速率限制，{{seconds}}s 后重试',
} as const;

export type LocaleKeys = keyof typeof zhCN;
export default zhCN;
