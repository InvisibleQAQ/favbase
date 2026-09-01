import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

export interface BackgroundJobsBarProps {
  /** Pre-translated caption per running background job (embed / tag).
   *  Empty → renders nothing (the component self-hides). */
  captions: string[];
}

/**
 * Progress captions for the post-sync background jobs (embed / tag), one row
 * each with a small spinner. Zero-`t()` dumb component (the components/collection
 * contract): the consuming view builds and translates the strings and hands
 * them in. Self-hides on an empty list.
 */
export function BackgroundJobsBar({ captions }: BackgroundJobsBarProps) {
  if (captions.length === 0) return null;
  return (
    <Stack spacing={0.5} sx={{ mb: 2 }}>
      {captions.map((caption) => (
        <Stack key={caption} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <CircularProgress size={12} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {caption}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}
