interface StatusBarProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  subtitleCount: number;
}

export function StatusBar({ loading, status, error, subtitleCount }: StatusBarProps) {
  if (loading) {
    return <div className="favbase-status favbase-status--loading">正在加载字幕...</div>;
  }

  if (status === 'error') {
    return (
      <div className="favbase-status favbase-status--error">
        加载失败: {error ?? '未知错误'}
      </div>
    );
  }

  if (status === 'no_subtitle') {
    return <div className="favbase-status favbase-status--empty">该视频无 AI 字幕</div>;
  }

  if (status === 'ok') {
    return (
      <div className="favbase-status favbase-status--ok">
        共 {subtitleCount} 条字幕 (B站 AI)
      </div>
    );
  }

  return null;
}
