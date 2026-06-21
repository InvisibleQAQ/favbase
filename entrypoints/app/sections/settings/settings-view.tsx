import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Alert from '@mui/material/Alert';

import { DashboardContent } from '../../layouts/dashboard';
import { useSettings } from '@/lib/hooks/useSettings';
import { LlmConfigCard } from './llm-config-card';
import { AsrConfigCard } from './asr-config-card';

export function SettingsView() {
  const s = useSettings();

  return (
    <DashboardContent maxWidth="lg">
      <Typography variant="h4" sx={{ mb: { xs: 3, md: 5 } }}>
        AI 服务配置
      </Typography>

      {s.saved && (
        <Alert severity="success" sx={{ mb: 3 }}>
          已保存
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12 }}>
          <LlmConfigCard
            settings={s.settings}
            currentProviderDef={s.currentProviderDef}
            currentLlmApiKey={s.currentLlmApiKey}
            currentLlmModel={s.currentLlmModel}
            isCustomProvider={s.isCustomProvider}
            switchProvider={s.switchProvider}
            updateLlmApiKey={s.updateLlmApiKey}
            updateLlmModel={s.updateLlmModel}
            updateCustomBaseUrl={s.updateCustomBaseUrl}
            updateCustomProtocol={s.updateCustomProtocol}
            updateTemperature={s.updateTemperature}
            updateMaxTokens={s.updateMaxTokens}
            updatePrefMode={s.updatePrefMode}
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <AsrConfigCard
            settings={s.settings}
            currentAsrDef={s.currentAsrDef}
            currentAsrApiKey={s.currentAsrApiKey}
            currentAsrModel={s.currentAsrModel}
            switchAsrProvider={s.switchAsrProvider}
            updateAsrApiKey={s.updateAsrApiKey}
            updateAsrModel={s.updateAsrModel}
          />
        </Grid>


      </Grid>
    </DashboardContent>
  );
}
