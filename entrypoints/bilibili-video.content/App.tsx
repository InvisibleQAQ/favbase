import { Panel } from './components/Panel';
import { useVideoDetect } from './hooks/useVideoDetect';
import { useSubtitle } from './hooks/useSubtitle';
import { useSettings } from './hooks/useSettings';

export default function App() {
  const video = useVideoDetect();
  const subtitle = useSubtitle(video.bvid, video.cid);
  const { loading: _, ...settingsProps } = useSettings();

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
      settingsProps={settingsProps}
    />
  );
}
