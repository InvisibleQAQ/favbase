import { useCallback, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import {
  checkHostPermission,
  requestHostPermission,
  type EnsurePermissionResult,
} from '@/lib/permissions/host-access';

interface PendingGrant {
  pattern: string;
  origin: string;
  resolve: (result: EnsurePermissionResult) => void;
}

/**
 * Bridges the two host-permission primitives with an explanation Dialog.
 *
 * `ensure` classifies the Base URL first (no prompt). When a custom https
 * origin needs a runtime grant, it opens a friendly Dialog explaining what is
 * being authorized (Bilitato-style copy) and defers the native Chrome prompt to
 * the Dialog's grant button — a fresh user gesture, so `browser.permissions.request`
 * still has transient user activation.
 */
export function useHostPermission() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingGrant | null>(null);

  const ensure = useCallback(async (baseUrl: string): Promise<EnsurePermissionResult> => {
    const state = await checkHostPermission(baseUrl);
    switch (state.status) {
      case 'granted':
        return { ok: true };
      case 'invalid-url':
        return { ok: false, reason: 'invalid-url' };
      case 'unsupported-scheme':
        return { ok: false, reason: 'unsupported-scheme' };
      case 'needs-grant':
        return new Promise<EnsurePermissionResult>((resolve) => {
          setPending({ pattern: state.pattern, origin: state.origin, resolve });
        });
    }
  }, []);

  const handleGrant = useCallback(async () => {
    if (!pending) return;
    const granted = await requestHostPermission(pending.pattern);
    pending.resolve(granted ? { ok: true } : { ok: false, reason: 'denied' });
    setPending(null);
  }, [pending]);

  const handleCancel = useCallback(() => {
    if (!pending) return;
    pending.resolve({ ok: false, reason: 'denied' });
    setPending(null);
  }, [pending]);

  const dialog = (
    <Dialog open={!!pending} onClose={handleCancel}>
      <DialogTitle>{t('settings.permission.dialogTitle')}</DialogTitle>
      <DialogContent>
        <DialogContentText>{t('settings.permission.dialogDesc')}</DialogContentText>
        {pending && (
          <Typography
            sx={{ mt: 2, fontFamily: 'monospace', fontWeight: 700, wordBreak: 'break-all' }}
          >
            {`${pending.origin}/*`}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>{t('settings.permission.cancel')}</Button>
        <Button variant="contained" onClick={handleGrant}>
          {t('settings.permission.grant')}
        </Button>
      </DialogActions>
    </Dialog>
  );

  return { ensure, dialog };
}
