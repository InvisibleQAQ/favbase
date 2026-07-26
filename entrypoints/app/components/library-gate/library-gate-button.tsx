import Button from '@mui/material/Button';

import { useTranslation } from '@/lib/i18n/use-translation';

import { Iconify } from '../iconify';
import { useCollectionGate } from './use-collection-gate';

export interface LibraryGateButtonProps {
  /** Loose platform key (job namespace or DB discriminator) — resolved by the gate. */
  platform: string;
}

/**
 * Per-platform "pause / resume library build" toggle. A SMART component (own
 * `useTranslation()` + gate subscription) — deliberately outside
 * `components/collection/`, whose iron rule is zero `t()`.
 */
export function LibraryGateButton({ platform }: LibraryGateButtonProps) {
  const { t } = useTranslation();
  const gate = useCollectionGate(platform);
  if (gate == null) return null;

  return (
    <Button
      data-library-gate
      data-gate-state={gate.paused ? 'paused' : 'running'}
      size="small"
      variant="text"
      color={gate.paused ? 'warning' : 'inherit'}
      startIcon={
        <Iconify icon={gate.paused ? 'solar:play-bold' : 'solar:pause-bold'} width={16} />
      }
      onClick={gate.paused ? gate.resume : gate.pause}
      sx={{
        flexShrink: 0,
        whiteSpace: 'nowrap',
        ...(gate.paused ? {} : { color: 'text.secondary' }),
      }}
    >
      {gate.paused ? t('pipeline.resumeLibrary') : t('pipeline.pauseLibrary')}
    </Button>
  );
}
