import { useState } from 'react';
import { Icon } from '@iconify/react';
import type { SubtitleRow, SubtitleSource } from '@/lib/subtitle/types';
import type { LocaleKeys } from '@/lib/i18n/locales/zh-CN';
import { useTranslation } from '@/lib/i18n/use-translation';
// Offline icon data is shared with app.html, but the `Iconify` wrapper next to
// it is NOT: it is a styled(Icon) from MUI, and Emotion injects its <style>
// into document.head — outside this Shadow DOM. Import the raw registry only.
import { registerIcons } from '@/entrypoints/app/components/iconify/register-icons';
import type { IconifyName } from '@/entrypoints/app/components/iconify/register-icons';
import { StatusBar } from './StatusBar';
import { SubtitleView } from './SubtitleView';
import { SettingsView } from './SettingsView';
import { SummaryView } from './SummaryView';
import { TranscribeButton } from './TranscribeButton';
import type { UseTranscribeReturn } from '../hooks/useTranscribe';
import type { UseSummaryReturn } from '../hooks/useSummary';

registerIcons();

const SIDEBAR_ICON_SIZE = 20;

interface SidebarTab {
  id: string;
  icon: IconifyName;
  label: LocaleKeys;
}

const SIDEBAR_TABS: SidebarTab[] = [
  { id: 'cc', icon: 'solar:subtitles-bold-duotone', label: 'sidebar.subtitles' },
  { id: 'summary', icon: 'solar:magic-stick-3-bold-duotone', label: 'sidebar.summary' },
  { id: 'settings', icon: 'solar:settings-bold-duotone', label: 'sidebar.settings' },
];

interface PanelProps {
  loading: boolean;
  status: 'ok' | 'no_subtitle' | 'error' | null;
  error: string | null;
  rows: SubtitleRow[];
  title: string;
  source: SubtitleSource;
  cached: boolean;
  showTranscribe: boolean;
  transcribe: UseTranscribeReturn;
  hasApiKey: boolean;
  summary: UseSummaryReturn;
  llmConfigured: boolean;
}

export function Panel({
  loading, status, error, rows, title,
  source, cached, showTranscribe, transcribe, hasApiKey,
  summary, llmConfigured,
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
            <Icon ssr icon={tab.icon} width={SIDEBAR_ICON_SIZE} height={SIDEBAR_ICON_SIZE} />
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
          {activeTab === 'summary' && (
            <SummaryView
              summary={summary}
              hasSubtitle={rows.length > 0}
              hasLlmKey={llmConfigured}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsView />
          )}
        </div>
      </div>
    </div>
  );
}
