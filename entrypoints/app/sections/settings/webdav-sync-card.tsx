import { useState, useEffect, useCallback } from 'react';
import { browser } from 'wxt/browser';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { formatDateTime } from '@/lib/i18n';
import {
  getWebdavConfig,
  setWebdavConfig,
  getSyncStatus,
  watchSyncStatus,
  type WebdavConfig,
  type WebdavSyncStatus,
} from '@/lib/sync';
import { sendBackgroundMessage } from '@/lib/background/client';
import { Iconify } from '../../components/iconify';
import { useHostPermission } from './use-host-permission';
import { permissionErrorKey } from './permission-error';

const EMPTY: WebdavConfig = { enabled: false, url: '', username: '', password: '' };

export function WebdavSyncCard() {
  const { t } = useTranslation();
  const { ensure, dialog } = useHostPermission();

  const [form, setForm] = useState<WebdavConfig>(EMPTY);
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState<WebdavSyncStatus | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void getWebdavConfig().then(setForm);
  }, []);

  useEffect(() => {
    void getSyncStatus().then(setStatus);
    return watchSyncStatus(setStatus);
  }, []);

  const persist = useCallback((next: WebdavConfig) => setWebdavConfig(next), []);

  const update = (patch: Partial<WebdavConfig>) => setForm((f) => ({ ...f, ...patch }));

  const handleToggleEnabled = async (enabled: boolean) => {
    const next = { ...form, enabled };
    setForm(next);
    await persist(next);
  };

  const syncing = status?.state === 'syncing';
  const hasCreds = !!form.url.trim() && !!form.username && !!form.password;

  const handleSyncNow = async () => {
    setLocalError(null);
    const url = form.url.trim();
    if (!/^https:\/\//i.test(url)) {
      setLocalError(t('settings.sync.err.httpsOnly'));
      return;
    }
    // Verify or restore required host access before the SW fetches.
    const res = await ensure(url);
    if (!res.ok) {
      setLocalError(t(permissionErrorKey(res.reason)));
      return;
    }
    await persist({ ...form, url });
    // The SW owns the engine + the persisted grant; status flows back via watch.
    const result = await sendBackgroundMessage({ type: 'WEBDAV_SYNC_NOW' });
    if (!result?.ok && result?.errorCode) {
      setLocalError(t(`settings.sync.err.${result.errorCode}`));
    }
  };

  const handleClearRemote = async () => {
    setConfirmOpen(false);
    setLocalError(null);
    setClearing(true);
    try {
      const result = await sendBackgroundMessage({
        type: 'WEBDAV_CLEAR_REMOTE',
      });
      if (!result?.ok && result?.errorCode) {
        setLocalError(t(`settings.sync.err.${result.errorCode}`));
      }
    } finally {
      setClearing(false);
    }
  };

  const stateLabel =
    status?.state === 'syncing'
      ? t('settings.sync.stateSyncing')
      : status?.state === 'error'
        ? t('settings.sync.stateError')
        : t('settings.sync.stateIdle');
  const stateColor =
    status?.state === 'error'
      ? 'error.main'
      : status?.state === 'syncing'
        ? 'info.main'
        : 'text.secondary';

  return (
    <Card>
      <CardHeader
        title={t('settings.sync.title')}
        subheader={t('settings.sync.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={form.enabled}
                  onChange={(e) => void handleToggleEnabled(e.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('settings.sync.enableLabel')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('settings.sync.enableHint')}
                  </Typography>
                </Box>
              }
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              type="url"
              label={t('settings.sync.urlLabel')}
              placeholder={t('settings.sync.urlPlaceholder')}
              value={form.url}
              onChange={(e) => update({ url: e.target.value })}
              onBlur={() => void persist(form)}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label={t('settings.sync.usernameLabel')}
              value={form.username}
              onChange={(e) => update({ username: e.target.value })}
              onBlur={() => void persist(form)}
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              type={showPassword ? 'text' : 'password'}
              label={t('settings.sync.passwordLabel')}
              placeholder={t('settings.sync.passwordPlaceholder')}
              value={form.password}
              onChange={(e) => update({ password: e.target.value })}
              onBlur={() => void persist(form)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton edge="end" size="small" onClick={() => setShowPassword((v) => !v)}>
                        <Iconify
                          icon={showPassword ? 'solar:eye-bold' : 'solar:eye-closed-bold'}
                          width={20}
                        />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Typography variant="caption" color="text.secondary">
              {t('settings.sync.noteHttps')}
            </Typography>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={() => void handleSyncNow()}
                disabled={!hasCreds || syncing}
                startIcon={
                  syncing ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <Iconify icon="solar:restart-bold" width={20} />
                  )
                }
              >
                {syncing ? t('settings.sync.syncing') : t('settings.sync.syncNow')}
              </Button>
              <Button
                variant="outlined"
                color="error"
                onClick={() => setConfirmOpen(true)}
                disabled={!hasCreds || syncing || clearing}
              >
                {t('settings.sync.clearRemote')}
              </Button>
            </Stack>
          </Grid>

          {/* Sync status */}
          <Grid size={{ xs: 12 }}>
            <Box
              sx={(theme) => ({
                p: 2,
                borderRadius: 1.5,
                bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
              })}
            >
              <Stack spacing={0.5}>
                <Typography variant="caption">
                  {t('settings.sync.statusLabel')}:{' '}
                  <Box component="span" sx={{ color: stateColor, fontWeight: 600 }}>
                    {stateLabel}
                  </Box>
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('settings.sync.lastSync')}:{' '}
                  {status && status.lastSyncTime > 0
                    ? formatDateTime(status.lastSyncTime)
                    : t('settings.sync.neverSynced')}
                </Typography>
                {status?.syncVersion && (
                  <Typography variant="caption" color="text.secondary">
                    {t('settings.sync.remoteVersion')}: {status.syncVersion.slice(0, 8)}
                  </Typography>
                )}
              </Stack>
            </Box>
          </Grid>

          {status?.state === 'error' && status.errorCode && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t(`settings.sync.err.${status.errorCode}`)}
                {status.errorDetail ? ` — ${status.errorDetail}` : ''}
              </Alert>
            </Grid>
          )}

          {localError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error" onClose={() => setLocalError(null)}>
                {localError}
              </Alert>
            </Grid>
          )}
        </Grid>
      </CardContent>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t('settings.sync.clearRemoteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('settings.sync.clearRemoteConfirmDesc')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('settings.sync.cancel')}</Button>
          <Button color="error" variant="contained" onClick={() => void handleClearRemote()}>
            {t('settings.sync.clearRemoteConfirmOk')}
          </Button>
        </DialogActions>
      </Dialog>

      {dialog}
    </Card>
  );
}
