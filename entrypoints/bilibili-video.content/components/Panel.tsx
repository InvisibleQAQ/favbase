import { useState } from 'react';
import type { SubtitleRow } from '@/lib/types';
import { t } from '@/lib/i18n';
import { StatusBar } from './StatusBar';
import { SubtitleView } from './SubtitleView';

interface PanelProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  rows: SubtitleRow[];
  title: string;
}

export function Panel({ loading, status, error, rows, title }: PanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={`favbase-panel ${collapsed ? 'favbase-panel--collapsed' : ''}`}>
      <div className="favbase-panel-header">
        <div className="favbase-panel-title">
          <span className="favbase-panel-logo">favbase</span>
          {title && <span className="favbase-panel-video-title" title={title}>{title}</span>}
        </div>
        <button
          className="favbase-collapse-btn"
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? t('panel.expand') : t('panel.collapse')}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {!collapsed && (
        <div className="favbase-panel-body">
          <StatusBar
            loading={loading}
            status={status}
            error={error}
            subtitleCount={rows.length}
          />
          {status === 'ok' && <SubtitleView rows={rows} />}
        </div>
      )}
    </div>
  );
}
