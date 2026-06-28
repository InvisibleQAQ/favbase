import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';

import { DashboardContent } from '../../layouts/dashboard';
import { useSettings } from '@/lib/hooks/useSettings';
import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocalePreference } from '@/lib/storage';
import { LlmConfigCard } from './llm-config-card';
import { AsrConfigCard } from './asr-config-card';

export function SettingsView() {
  const s = useSettings();
  const { t, preference, setLocale } = useTranslation();

  return (
    <DashboardContent maxWidth="lg">
      <Typography variant="h4" sx={{ mb: { xs: 3, md: 5 } }}>
        {t('settings.title')}
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

        <Grid size={{ xs: 12 }}>
          <Card>
            <CardContent>
              <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 600 }}>
                {t('settings.language')}
              </Typography>
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <InputLabel>{t('settings.language')}</InputLabel>
                <Select
                  value={preference}
                  label={t('settings.language')}
                  onChange={(e) => setLocale(e.target.value as LocalePreference)}
                >
                  <MenuItem value="auto">{t('settings.languageAuto')}</MenuItem>
                  <MenuItem value="zh-CN">{t('settings.languageZhCN')}</MenuItem>
                  <MenuItem value="en">{t('settings.languageEn')}</MenuItem>
                </Select>
              </FormControl>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </DashboardContent>
  );
}
