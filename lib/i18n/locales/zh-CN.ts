const zhCN = {
  'status.loading': '正在加载字幕...',
  'status.error': '加载失败: {{error}}',
  'status.errorUnknown': '未知错误',
  'status.noSubtitle': '该视频无 AI 字幕',
  'status.count': '共 {{count}} 条字幕 (B站 AI)',

  'panel.expand': '展开面板',
  'panel.collapse': '收起面板',

  'subtitle.jumpTo': '跳转到 {{time}}',
} as const;

export type LocaleKeys = keyof typeof zhCN;
export default zhCN;
