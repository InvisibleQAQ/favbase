import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';

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

      <Grid container spacing={3}>
        <Grid size={{ xs: 12 }}>
          <LlmConfigCard
            settings={s.settings}
            currentProviderDef={s.currentProviderDef}
            currentLlmApiKey={s.currentLlmApiKey}
            currentLlmModel={s.currentLlmModel}
            isCustomProvider={s.isCustomProvider}
            saved={s.saved}
            updateLlm={s.updateLlm}
          />
        </Grid>

        <Grid size={{ xs: 12 }}>
          <AsrConfigCard
            settings={s.settings}
            currentAsrDef={s.currentAsrDef}
            currentAsrApiKey={s.currentAsrApiKey}
            currentAsrModel={s.currentAsrModel}
            updateAsr={s.updateAsr}
          />
        </Grid>


      </Grid>
    </DashboardContent>
  );
}
