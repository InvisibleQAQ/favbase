import { useState } from 'react';
import type { SubtitleRow } from '@/lib/transcription/types';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';
import { StatusBar } from './StatusBar';
import { SubtitleView } from './SubtitleView';
import { SettingsView, type SettingsViewProps } from './SettingsView';
import { TranscribeButton } from './TranscribeButton';
import type { UseTranscribeReturn } from '../hooks/useTranscribe';

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
  source: 'bilibili' | 'groq';
  cached: boolean;
  showTranscribe: boolean;
  transcribe: UseTranscribeReturn;
  hasApiKey: boolean;
  settingsProps: SettingsViewProps;
}

export function Panel({
  loading, status, error, rows, title,
  source, cached, showTranscribe, transcribe, hasApiKey,
  settingsProps,
}: PanelProps) {
  const { t } = useTranslation();
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
              />
              {(showTranscribe || transcribe.transcribing || transcribe.error) && (
                <TranscribeButton
                  transcribe={transcribe}
                  hasApiKey={hasApiKey}
                />
              )}
              {status === 'ok' && (
                <SubtitleView rows={rows} source={source} cached={cached} />
              )}
            </>
          )}
          {activeTab === 'settings' && (
            <SettingsView {...settingsProps} />
          )}
        </div>
      </div>
    </div>
  );
}
