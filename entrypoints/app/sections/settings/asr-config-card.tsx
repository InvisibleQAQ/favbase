import { useState } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';

import { useTranslation } from '@/lib/i18n/use-translation';
import { Iconify } from '../../components/iconify';
import { ASR_PROVIDERS, type ASRProviderId, type ASRProviderDef } from '@/lib/providers';
import type { UserSettings } from '@/lib/storage';
import type { AsrUpdate } from '@/lib/hooks/useSettings';

interface AsrConfigCardProps {
  settings: UserSettings;
  currentAsrDef: ASRProviderDef;
  currentAsrApiKey: string;
  currentAsrModel: string;
  updateAsr: (update: AsrUpdate) => void;
}

export function AsrConfigCard({
  settings,
  currentAsrDef,
  currentAsrApiKey,
  currentAsrModel,
  updateAsr,
}: AsrConfigCardProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);

  return (
    <Card>
      <CardHeader
        title={t('settings.asrCard.title')}
        subheader={t('settings.asrCard.description')}
      />
      <CardContent>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              label={t('settings.asrProvider')}
              value={settings.asrProvider}
              onChange={(e) => updateAsr({ field: 'provider', value: e.target.value as ASRProviderId })}
            >
              {ASR_PROVIDERS.map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </TextField>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.apiKey')}
              type={showKey ? 'text' : 'password'}
              placeholder={t('settings.apiKeyPlaceholder')}
              value={currentAsrApiKey}
              onChange={(e) => updateAsr({ field: 'apiKey', value: e.target.value })}
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

          <Grid size={{ xs: 12, md: 6 }}>
            <TextField
              fullWidth
              label={t('settings.model')}
              placeholder={currentAsrDef.defaultModel}
              value={currentAsrModel}
              onChange={(e) => updateAsr({ field: 'model', value: e.target.value })}
            />
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
}
