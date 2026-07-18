import { useCallback, useState } from 'react';
import Box from '@mui/material/Box';
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
import { varAlpha } from 'minimal-shared/utils';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import type { UserSettings } from '@/lib/storage';
import { deriveYoutubeDraft, type YoutubeDraft } from '@/lib/hooks/useSettings';
import {
  resolveChannel,
  YoutubeAuthError,
  YoutubeRateLimitError,
  type YoutubeChannelInfo,
} from '@/lib/youtube/youtube-api';
import { useConfigDraft } from './use-config-draft';
import { SaveActions } from './save-actions';

// `provider` is constant ('youtube'); apiKey + channel are the real
// connection fields (both feed the channels.list probe).
const YOUTUBE_CONNECTION_KEYS = ['provider', 'apiKey', 'channel'] as const satisfies readonly (keyof YoutubeDraft)[];

const GOOGLE_CLOUD_CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials';

const GUIDE_STEP_KEYS = [
  'settings.youtube.guideStep1',
  'settings.youtube.guideStep2',
  'settings.youtube.guideStep3',
  'settings.youtube.guideStep4',
] as const;

interface YoutubeConnectionCardProps {
  settings: UserSettings;
  saveYoutube: (draft: YoutubeDraft) => Promise<void>;
}

export function YoutubeConnectionCard({ settings, saveYoutube }: YoutubeConnectionCardProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);

  const derive = useCallback(() => deriveYoutubeDraft(settings), [settings]);

  // Test = channels.list probe: resolves the channel input (@handle / UC… id /
  // URL) with the draft API key and shows the channel name + avatar on success.
  const runTest = useCallback(
    async (dr: YoutubeDraft): Promise<YoutubeChannelInfo> => {
      try {
        return await resolveChannel(dr.apiKey, dr.channel);
      } catch (err) {
        // i18n seam: structured lib errors → locale keys at the UI boundary.
        if (err instanceof YoutubeAuthError) {
          throw new Error(t('settings.youtube.invalidKey'));
        }
        if (err instanceof YoutubeRateLimitError) {
          // Google sends no reset header — resetAt is always null.
          throw new Error(t('settings.youtube.rateLimited'));
        }
        if (err instanceof Error && err.message.includes('channel not found')) {
          throw new Error(t('settings.youtube.channelNotFound'));
        }
        throw err;
      }
    },
    [t],
  );

  const d = useConfigDraft<YoutubeDraft, YoutubeChannelInfo>({
    derive,
    connectionKeys: YOUTUBE_CONNECTION_KEYS,
    runTest,
    save: saveYoutube,
  });
  const { draft, setField } = d;

  return (
    <Card>
      <CardHeader
        title={t('settings.youtube.title')}
        subheader={t('settings.youtube.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <TextField
              fullWidth
              label={t('settings.youtube.apiKeyLabel')}
              type={showKey ? 'text' : 'password'}
              placeholder={t('settings.youtube.apiKeyPlaceholder')}
              value={draft.apiKey}
              onChange={(e) => setField('apiKey', e.target.value)}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        edge="end"
                        onClick={() => setShowKey((v) => !v)}
                        size="small"
                      >
                        <Iconify
                          icon={showKey ? 'solar:eye-bold' : 'solar:eye-closed-bold'}
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
            <TextField
              fullWidth
              label={t('settings.youtube.channelLabel')}
              placeholder={t('settings.youtube.channelPlaceholder')}
              value={draft.channel}
              onChange={(e) => setField('channel', e.target.value)}
            />
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
              {t('settings.youtube.channelNote')}
            </Typography>

            <Box
              sx={(theme) => ({
                mt: 2,
                p: 2,
                borderRadius: 1.5,
                bgcolor: varAlpha(theme.vars.palette.grey['500Channel'], 0.08),
              })}
            >
              <Typography
                variant="caption"
                sx={{ display: 'block', mb: 0.5, fontWeight: 'fontWeightSemiBold', color: 'text.primary' }}
              >
                {t('settings.youtube.guideTitle')}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mb: 0.5, color: 'text.secondary' }}>
                {t('settings.youtube.freeQuotaNote')}
              </Typography>
              <Typography
                component="ol"
                variant="caption"
                sx={{ m: 0, pl: 2.5, color: 'text.secondary', listStyleType: 'decimal', '& li': { mb: 0.25 } }}
              >
                {GUIDE_STEP_KEYS.map((key) => (
                  <li key={key}>{t(key)}</li>
                ))}
              </Typography>
              <Link
                href={GOOGLE_CLOUD_CREDENTIALS_URL}
                target="_blank"
                rel="noopener noreferrer"
                variant="caption"
                sx={{ display: 'inline-block', mt: 1 }}
              >
                {t('settings.youtube.openConsole')}
              </Link>
            </Box>
          </Grid>

          <Grid size={{ xs: 12 }}>
            <SaveActions
              onTest={d.handleTest}
              testDisabled={!draft.apiKey || !draft.channel}
              testing={d.isTesting}
              onSave={d.handleSave}
              saveDisabled={!d.canSave}
              saving={d.isSaving}
              savedAt={settings.configSavedAt?.youtube}
              showTestHint={d.connectionDirty && !d.verified}
            />
          </Grid>

          {d.testResult && d.verified && (
            <Grid size={{ xs: 12 }}>
              <Alert
                severity="success"
                icon={
                  <Avatar src={d.testResult.avatarUrl} sx={{ width: 22, height: 22 }}>
                    <Iconify icon="mdi:youtube" width={16} />
                  </Avatar>
                }
              >
                {t('settings.youtube.testSuccess', { title: d.testResult.title })}
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
