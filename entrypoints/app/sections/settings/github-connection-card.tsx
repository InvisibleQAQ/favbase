import { useState, useCallback } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import Alert from '@mui/material/Alert';
import Avatar from '@mui/material/Avatar';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import { useTranslation } from '@/lib/i18n/use-translation';
import { formatDateTime } from '@/lib/i18n';
import { Iconify } from '../../components/iconify';
import type { UserSettings } from '@/lib/storage';
import { deriveGithubDraft, type GithubDraft } from '@/lib/hooks/useSettings';
import {
  validateToken,
  GithubAuthError,
  GithubRateLimitError,
  type GithubUser,
} from '@/lib/github/github-api';
import { useConfigDraft } from './use-config-draft';
import { SaveActions } from './save-actions';

// `provider` is constant ('github'); `token` is the only real connection field.
const GITHUB_CONNECTION_KEYS = ['provider', 'token'] as const satisfies readonly (keyof GithubDraft)[];

const GITHUB_TOKEN_SETTINGS_URL = 'https://github.com/settings/tokens';

interface GithubConnectionCardProps {
  settings: UserSettings;
  saveGithub: (draft: GithubDraft) => Promise<void>;
}

export function GithubConnectionCard({ settings, saveGithub }: GithubConnectionCardProps) {
  const { t } = useTranslation();
  const [showToken, setShowToken] = useState(false);

  const derive = useCallback(() => deriveGithubDraft(settings), [settings]);

  // api.github.com is in the static host_permissions (added with the github
  // domain layer), so no useHostPermission gate is needed — unlike the
  // LLM/Embedding cards with custom base URLs.
  const runTest = useCallback(
    async (dr: GithubDraft): Promise<GithubUser> => {
      try {
        return await validateToken(dr.token);
      } catch (err) {
        // i18n seam: lib errors carry English debug text only — map the
        // structured error types to locale keys here at the UI boundary.
        if (err instanceof GithubAuthError) {
          throw new Error(t('settings.github.invalidToken'));
        }
        if (err instanceof GithubRateLimitError) {
          throw new Error(
            err.resetAt
              ? t('settings.github.rateLimited', { reset: formatDateTime(err.resetAt.getTime()) })
              : t('settings.github.rateLimitedNoReset'),
          );
        }
        throw err;
      }
    },
    [t],
  );

  const d = useConfigDraft<GithubDraft, GithubUser>({
    derive,
    connectionKeys: GITHUB_CONNECTION_KEYS,
    runTest,
    save: saveGithub,
  });
  const { draft, setField } = d;

  return (
    <Card>
      <CardHeader
        title={t('settings.github.title')}
        subheader={t('settings.github.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label={t('settings.github.tokenLabel')}
              type={showToken ? 'text' : 'password'}
              placeholder={t('settings.github.tokenPlaceholder')}
              value={draft.token}
              onChange={(e) => setField('token', e.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() => setShowToken((v) => !v)}
                        size="small"
                      >
                        <Iconify
                          icon={showToken ? 'solar:eye-bold' : 'solar:eye-closed-bold'}
                          width={20}
                        />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
              {t('settings.github.hint')}{' '}
              <Link href={GITHUB_TOKEN_SETTINGS_URL} target="_blank" rel="noopener noreferrer">
                {t('settings.github.createToken')}
              </Link>
            </Typography>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <SaveActions
              onTest={d.handleTest}
              testDisabled={!draft.token}
              testing={d.isTesting}
              onSave={d.handleSave}
              saveDisabled={!d.canSave}
              saving={d.isSaving}
              savedAt={settings.configSavedAt?.github}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {d.testResult && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={<Avatar src={d.testResult.avatarUrl} sx={{ width: 22, height: 22 }} />}
              >
                {t('settings.github.testSuccess', { login: d.testResult.login })}
              </Alert>
            </Grid>
          )}

          {d.testError && (
            <Grid size={{ xs: 12 }}>
              <Alert severity="error">
                {t('settings.testFailedDetail', { error: d.testError })}
              </Alert>
            </Grid>
          )}
        </Grid>
      </CardContent>
    </Card>
  );
}
