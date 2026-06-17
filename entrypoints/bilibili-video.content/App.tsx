import { Panel } from './components/Panel';
import { useVideoDetect } from './hooks/useVideoDetect';
import { useSubtitle } from './hooks/useSubtitle';
import { useSettings } from './hooks/useSettings';

export default function App() {
  const video = useVideoDetect();
  const subtitle = useSubtitle(video.bvid, video.cid);
  const { settings, updateSettings, saved } = useSettings();

  // Still loading video info — show loading panel
  const loading = video.loading || subtitle.loading;
  const status = video.error ? 'error' as const : subtitle.status;
  const error = video.error ?? subtitle.error;

  return (
    <Panel
      loading={loading}
      status={status}
      error={error}
      rows={subtitle.rows}
      title={video.title}
      settings={settings}
      onUpdateSettings={updateSettings}
      settingsSaved={saved}
    />
  );
}
