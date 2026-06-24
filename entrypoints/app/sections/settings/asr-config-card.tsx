import { useState } from 'react';
import Card from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import TextField from '@mui/material/TextField';
import MenuItem from '@mui/material/MenuItem';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';

import { Iconify } from '../../components/iconify';
import { ASR_PROVIDERS, type ASRProviderId } from '@/lib/providers';
import type { UserSettings, ASRProviderDef } from '@/lib/types';
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
  const [showKey, setShowKey] = useState(false);

  return (
    <Card>
      <CardHeader
        title="ASR 语音转录"
        subheader="配置语音识别服务以转录视频音频"
      />
      <CardContent>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12 }}>
            <TextField
              select
              fullWidth
              label="ASR 服务商"
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
              label="API Key"
              type={showKey ? 'text' : 'password'}
              placeholder="输入 API Key"
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
              label="模型"
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
