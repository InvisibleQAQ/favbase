import { useState } from 'react';
import type { SubtitleRow, UserSettings } from '@/lib/types';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { t } from '@/lib/i18n';
import { StatusBar } from './StatusBar';
import { SubtitleView } from './SubtitleView';
import { SettingsView } from './SettingsView';

interface SidebarTab {
  id: string;
  icon: string;
  label: LocaleKeys;
}

const SIDEBAR_TABS: SidebarTab[] = [
  { id: 'cc', icon: 'CC', label: 'sidebar.subtitles' },
  { id: 'settings', icon: '⚙', label: 'sidebar.settings' },
];

interface PanelProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  rows: SubtitleRow[];
  title: string;
  settings: UserSettings;
  onUpdateSettings: (patch: Partial<UserSettings>) => void;
  settingsSaved: boolean;
}

export function Panel({
  loading, status, error, rows, title,
  settings, onUpdateSettings, settingsSaved,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('cc');
  const toggle = () => setCollapsed((c) => !c);

  return (
    <div className={`favbase-panel ${collapsed ? 'favbase-panel--collapsed' : ''}`}>
      <div className="favbase-sidebar">
        {SIDEBAR_TABS.map((tab) => (
          <button
            key={tab.id}
            className={
              `favbase-sidebar-icon${tab.id === activeTab ? ' favbase-sidebar-icon--active' : ''}`
            }
            title={t(tab.label)}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      <div className="favbase-panel-main">
        <div className="favbase-panel-header" onClick={toggle}>
          <div className="favbase-panel-title">
            <span className="favbase-panel-logo">favbase</span>
            {title && <span className="favbase-panel-video-title" title={title}>{title}</span>}
          </div>
          <button
            className="favbase-collapse-btn"
            type="button"
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            title={collapsed ? t('panel.expand') : t('panel.collapse')}
          >
            {collapsed ? '▼' : '▲'}
          </button>
        </div>

        <div className="favbase-panel-body">
          {activeTab === 'cc' && (
            <>
              <StatusBar
                loading={loading}
                status={status}
                error={error}
                subtitleCount={rows.length}
              />
              {status === 'ok' && <SubtitleView rows={rows} />}
            </>
          )}
          {activeTab === 'settings' && (
            <SettingsView
              settings={settings}
              onUpdate={onUpdateSettings}
              saved={settingsSaved}
            />
          )}
        </div>
      </div>
    </div>
  );
}
