import type { SubtitleSource } from '@/lib/subtitle/types';
import { Panel } from './components/Panel';
import { useVideoDetect } from './hooks/useVideoDetect';
import { useSubtitle } from './hooks/useSubtitle';
import { useSettings } from '@/lib/hooks/useSettings';
import { useTranscribe } from './hooks/useTranscribe';
import { useSummary } from './hooks/useSummary';

export default function App() {
  const video = useVideoDetect();
  const subtitle = useSubtitle(video.bvid, video.cid);
  const { currentAsrApiKey, llmConfigured } = useSettings();

  const transcribe = useTranscribe(
    video.bvid,
    video.cid,
    video.title,
    !!currentAsrApiKey,
  );

  const summary = useSummary(video.bvid, video.title);

  const showTranscribe =
    (subtitle.status === 'no_subtitle' || subtitle.status === 'error') &&
    transcribe.rows.length === 0;

  const effectiveRows =
    transcribe.rows.length > 0 ? transcribe.rows : subtitle.rows;
  const effectiveStatus =
    transcribe.rows.length > 0 ? ('ok' as const) : subtitle.status;
  const effectiveSource: SubtitleSource =
    transcribe.rows.length > 0 ? 'asr' : (subtitle.source ?? 'official');
  const effectiveCached =
    transcribe.rows.length > 0 ? transcribe.cached : subtitle.cached;

  const loading = video.loading || subtitle.loading;
  const status = video.error ? ('error' as const) : effectiveStatus;
  const error = video.error ?? subtitle.error;

  return (
    <Panel
      loading={loading}
      status={status}
      error={error}
      rows={effectiveRows}
      title={video.title}
      source={effectiveSource}
      cached={effectiveCached}
      showTranscribe={showTranscribe}
      transcribe={transcribe}
      hasApiKey={!!currentAsrApiKey}
      summary={summary}
      llmConfigured={llmConfigured}
    />
  );
}
