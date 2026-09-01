import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { varAlpha } from 'minimal-shared/utils';

import { sendBackgroundMessage } from '@/lib/background/client';
import { formatClock } from '@/lib/format';
import { formatDateTime, type LocaleKeys } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import {
  DEFAULT_AGENT_BRIDGE_CONFIG,
  DEFAULT_AGENT_BRIDGE_STATUS,
  getAgentBridgeConfig,
  getAgentBridgeStatus,
  setAgentBridgeConfig,
  watchAgentBridgeConfig,
  watchAgentBridgeStatus,
  type AgentBridgeConfig,
  type AgentBridgeConnectionState,
} from '@/lib/storage';
import { Iconify } from '../../components/iconify';
import { SettingsPanel } from './settings-panel';

type DisplayState = AgentBridgeConnectionState | 'loading';
type CopyTarget = 'token' | 'setup';
type CopyFeedback = { target: CopyTarget; ok: boolean };

const STATE_LABELS: Record<DisplayState, LocaleKeys> = {
  loading: 'settings.agentBridge.stateLoading',
  disabled: 'settings.agentBridge.stateDisabled',
  disconnected: 'settings.agentBridge.stateDisconnected',
  connecting: 'settings.agentBridge.stateConnecting',
  connected: 'settings.agentBridge.stateConnected',
};

export function parseAgentBridgePort(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const port = Number(trimmed);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

export function encodeAgentBridgeToken(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function generateAgentBridgeToken(): string {
  return encodeAgentBridgeToken(crypto.getRandomValues(new Uint8Array(32)));
}

/**
 * One-time pairing command for the favbase CLI (`packages/favbase-cli`): writes
 * `~/.favbase/config.json` and installs the Agent Skill for Claude Code and
 * Codex. The same command serves every agent, so there is a single copy button.
 */
export function buildSetupCommand(token: string, port: number): string {
  return `npx -y favbase-cli setup --token ${token} --port ${port}`;
}

export function formatRetryCountdown(retryAt: number, now: number): string {
  const remainingSeconds = Math.ceil(Math.max(0, retryAt - now) / 1_000);
  return formatClock(remainingSeconds).padStart(5, '0');
}

function stateColor(state: DisplayState): 'default' | 'warning' | 'info' | 'success' {
  switch (state) {
    case 'disconnected':
      return 'warning';
    case 'connecting':
      return 'info';
    case 'connected':
      return 'success';
    default:
      return 'default';
  }
}

function statusErrorKey(error: string): LocaleKeys {
  switch (error) {
    case 'missing-token':
      return 'settings.agentBridge.errorMissingToken';
    case 'invalid-port':
      return 'settings.agentBridge.errorInvalidPort';
    case 'bad-token':
      return 'settings.agentBridge.errorBadToken';
    case 'bad-origin':
      return 'settings.agentBridge.errorBadOrigin';
    case 'version':
      return 'settings.agentBridge.errorVersion';
    case 'connection-closed':
      return 'settings.agentBridge.errorConnectionClosed';
    default:
      return 'settings.agentBridge.errorConnection';
  }
}

export function AgentBridgeCard() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<AgentBridgeConfig>(DEFAULT_AGENT_BRIDGE_CONFIG);
  const [status, setStatus] = useState(DEFAULT_AGENT_BRIDGE_STATUS);
  const [portInput, setPortInput] = useState(String(DEFAULT_AGENT_BRIDGE_CONFIG.port));
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const configRef = useRef(config);
  const portDirtyRef = useRef(false);

  const applyConfig = useCallback((next: AgentBridgeConfig) => {
    configRef.current = next;
    setConfig(next);
    if (!portDirtyRef.current) setPortInput(String(next.port));
  }, []);

  useEffect(() => {
    let active = true;
    let configRevision = 0;
    let statusRevision = 0;

    const unwatchConfig = watchAgentBridgeConfig((next) => {
      configRevision += 1;
      if (!active) return;
      applyConfig(next);
      setReady(true);
    });
    const unwatchStatus = watchAgentBridgeStatus((next) => {
      statusRevision += 1;
      if (active) setStatus(next);
    });

    void getAgentBridgeConfig()
      .then((next) => {
        if (!active) return;
        if (configRevision === 0) applyConfig(next);
        setReady(true);
      })
      .catch(() => {
        if (active) setLocalError(t('settings.agentBridge.loadFailed'));
      });
    void getAgentBridgeStatus()
      .then((next) => {
        if (active && statusRevision === 0) setStatus(next);
      })
      .catch(() => {
        if (active) setLocalError(t('settings.agentBridge.loadFailed'));
      });

    return () => {
      active = false;
      unwatchConfig();
      unwatchStatus();
    };
  }, [applyConfig, t]);

  useEffect(() => {
    const retryAt = status.nextRetryAt;
    const initialNow = Date.now();
    setClockNow(initialNow);
    if (!config.enabled || retryAt === null || retryAt <= initialNow) return;

    const interval = setInterval(() => {
      const nextNow = Date.now();
      setClockNow(nextNow);
      if (nextNow >= retryAt) clearInterval(interval);
    }, 1_000);
    return () => clearInterval(interval);
  }, [config.enabled, status.nextRetryAt]);

  const persistConfig = useCallback(async (next: AgentBridgeConfig) => {
    const previous = configRef.current;
    setSaving(true);
    setLocalError(null);
    applyConfig(next);

    try {
      await setAgentBridgeConfig(next);
    } catch {
      applyConfig(previous);
      setLocalError(t('settings.agentBridge.saveFailed'));
      setSaving(false);
      return false;
    }

    try {
      await sendBackgroundMessage({ type: 'AGENT_BRIDGE_CONNECT_NOW' });
    } catch {
      setLocalError(t('settings.agentBridge.connectRequestFailed'));
    } finally {
      setSaving(false);
    }
    return true;
  }, [applyConfig, t]);

  const handleToggle = async (enabled: boolean) => {
    const current = configRef.current;
    const token = enabled && current.token === '' ? generateAgentBridgeToken() : current.token;
    await persistConfig({
      ...current,
      enabled,
      token,
      tokenCreatedAt: token !== current.token ? Date.now() : current.tokenCreatedAt,
    });
  };

  const handlePortCommit = async () => {
    const port = parseAgentBridgePort(portInput);
    if (port === null) return;
    portDirtyRef.current = false;
    if (port === configRef.current.port) return;
    await persistConfig({ ...configRef.current, port });
  };

  const handleGenerateToken = async () => {
    const token = generateAgentBridgeToken();
    await persistConfig({
      ...configRef.current,
      token,
      tokenCreatedAt: Date.now(),
    });
    setShowToken(false);
  };

  const handleCopy = async (target: CopyTarget, value: string) => {
    setCopyFeedback(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(value);
      setCopyFeedback({ target, ok: true });
    } catch {
      setCopyFeedback({ target, ok: false });
    }
  };

  const parsedPort = parseAgentBridgePort(portInput);
  const commandReady = ready && config.token !== '' && parsedPort === config.port;
  const displayState: DisplayState = !ready
    ? 'loading'
    : config.enabled
      ? status.state
      : 'disabled';
  const statusError = config.enabled && status.lastError
    ? t(statusErrorKey(status.lastError))
    : null;
  const badToken = config.enabled && status.lastError === 'bad-token';
  const retryCountdown = config.enabled
    && status.nextRetryAt !== null
    && status.nextRetryAt > clockNow
      ? formatRetryCountdown(status.nextRetryAt, clockNow)
      : null;
  const controlsDisabled = !ready || saving;
  const tokenActionLabel = config.token
    ? t('settings.agentBridge.resetToken')
    : t('settings.agentBridge.generateToken');

  return (
    <SettingsPanel
        title={t('settings.agentBridge.title')}
        description={t('settings.agentBridge.description')}
      >
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={config.enabled}
                  disabled={controlsDisabled}
                  onChange={(event) => void handleToggle(event.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {t('settings.agentBridge.enableLabel')}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('settings.agentBridge.enableHint')}
                  </Typography>
                </Box>
              }
            />
          </Grid>

          <Grid size={{ xs: 12, sm: 6 }}>
            <TextField
              fullWidth
              label={t('settings.agentBridge.portLabel')}
              value={portInput}
              disabled={controlsDisabled}
              error={parsedPort === null}
              helperText={
                parsedPort === null
                  ? t('settings.agentBridge.portInvalid')
                  : t('settings.agentBridge.portHint')
              }
              onChange={(event) => {
                portDirtyRef.current = true;
                setPortInput(event.target.value);
              }}
              onBlur={() => void handlePortCommit()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              slotProps={{
                htmlInput: { inputMode: 'numeric', min: 1, max: 65_535, step: 1 },
              }}
            />
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Stack spacing={1.5}>
              <TextField
                fullWidth
                type={showToken ? 'text' : 'password'}
                label={t('settings.agentBridge.tokenLabel')}
                value={config.token}
                placeholder={t('settings.agentBridge.tokenPlaceholder')}
                helperText={t('settings.agentBridge.tokenHint')}
                slotProps={{
                  input: {
                    readOnly: true,
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip
                          title={
                            showToken
                              ? t('settings.agentBridge.hideToken')
                              : t('settings.agentBridge.showToken')
                          }
                        >
                          <span>
                            <IconButton
                              edge="end"
                              disabled={config.token === ''}
                              aria-label={
                                showToken
                                  ? t('settings.agentBridge.hideToken')
                                  : t('settings.agentBridge.showToken')
                              }
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => setShowToken((value) => !value)}
                            >
                              <Iconify
                                icon={showToken ? 'solar:eye-closed-bold' : 'solar:eye-bold'}
                                width={20}
                              />
                            </IconButton>
                          </span>
                        </Tooltip>
                        <Tooltip title={t('settings.agentBridge.copyToken')}>
                          <span>
                            <IconButton
                              edge="end"
                              disabled={config.token === ''}
                              aria-label={t('settings.agentBridge.copyToken')}
                              onClick={() => void handleCopy('token', config.token)}
                            >
                              <Iconify icon="lucide:copy" width={20} />
                            </IconButton>
                          </span>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Box>
                <Button
                  variant="outlined"
                  disabled={controlsDisabled}
                  startIcon={
                    <Iconify
                      icon={config.token ? 'solar:restart-bold' : 'solar:shield-keyhole-bold-duotone'}
                      width={20}
                    />
                  }
                  onClick={() => void handleGenerateToken()}
                >
                  {tokenActionLabel}
                </Button>
              </Box>
            </Stack>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <Box
              role="status"
              sx={(theme) => ({
                p: 2,
                borderRadius: 0.5,
                bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
              })}
            >
              <Stack spacing={1}>
                <Stack direction="row" spacing={1.5} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                  <Typography variant="subtitle2">
                    {t('settings.agentBridge.statusLabel')}
                  </Typography>
                  <Chip
                    size="small"
                    color={stateColor(displayState)}
                    label={t(STATE_LABELS[displayState])}
                  />
                </Stack>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('settings.agentBridge.lastConnected')}:{' '}
                  {status.lastConnectedAt === null
                    ? t('settings.agentBridge.neverConnected')
                    : formatDateTime(status.lastConnectedAt)}
                </Typography>
                {config.enabled && status.lastAuthFailureAt !== null && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('settings.agentBridge.lastAuthFailure')}:{' '}
                    {formatDateTime(status.lastAuthFailureAt)}
                  </Typography>
                )}
                {retryCountdown && (
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {t('settings.agentBridge.retryIn', { time: retryCountdown })}
                  </Typography>
                )}
                {statusError && !badToken && (
                  <Typography variant="caption" sx={{ color: 'error.main' }}>
                    {statusError}
                  </Typography>
                )}
              </Stack>
            </Box>
          </Grid>

          {badToken && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
                  <Typography variant="body2">{statusError}</Typography>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={!commandReady || saving}
                    startIcon={<Iconify icon="lucide:copy" width={18} />}
                    onClick={() => {
                      void handleCopy('setup', buildSetupCommand(config.token, config.port));
                    }}
                  >
                    {copyFeedback?.target === 'setup' && copyFeedback.ok
                      ? t('settings.agentBridge.copied')
                      : t('settings.agentBridge.copySetupToFix')}
                  </Button>
                </Stack>
              </Alert>
            </Grid>
          )}

          <Grid size={{ xs: 12 }}>
            <Box component="section" aria-labelledby="agent-bridge-command-title">
              <Typography id="agent-bridge-command-title" variant="subtitle2" sx={{ mb: 0.75 }}>
                {t('settings.agentBridge.commandsTitle')}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
                {t('settings.agentBridge.commandsHint')}
              </Typography>
              <Box>
                <Button
                  variant="outlined"
                  disabled={!commandReady || saving}
                  startIcon={<Iconify icon="lucide:copy" width={20} />}
                  onClick={() => {
                    void handleCopy('setup', buildSetupCommand(config.token, config.port));
                  }}
                >
                  {copyFeedback?.target === 'setup' && copyFeedback.ok
                    ? t('settings.agentBridge.copied')
                    : t('settings.agentBridge.copySetup')}
                </Button>
              </Box>
            </Box>
          </Grid>

          {copyFeedback && (
            <Grid size={{ xs: 12 }}>
              <Alert severity={copyFeedback.ok ? 'success' : 'error'}>
                {copyFeedback.ok
                  ? t('settings.agentBridge.copySuccess')
                  : t('settings.agentBridge.copyFailed')}
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
      </SettingsPanel>
  );
}
