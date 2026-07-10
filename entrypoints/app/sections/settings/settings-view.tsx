import { useState } from 'react';
import Typography from '@mui/material/Typography';
import Grid from '@mui/material/Grid';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';

import { DashboardContent } from '../../layouts/dashboard';
import { useSettings } from '@/lib/hooks/useSettings';
import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocalePreference } from '@/lib/storage';
import { LlmConfigCard } from './llm-config-card';
import { AsrConfigCard } from './asr-config-card';
import { EmbeddingConfigCard } from './embedding-config-card';
import { ExportCard } from '../overview/export-card';
import { SettingsTabs, type SettingsTabItem } from './settings-tabs';
import { AiConfigNav, type AiSection, type AiConfigNavItem } from './ai-config-nav';

type SettingsTab = 'ai' | 'general' | 'storage';

export function SettingsView() {
  const s = useSettings();
  const { t, preference, setLocale } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [aiSection, setAiSection] = useState<AiSection>('llm');

  const tabs: SettingsTabItem[] = [
    { value: 'ai', label: t('settings.tabAi'), icon: 'solar:magic-stick-3-bold-duotone' },
    { value: 'general', label: t('settings.tabGeneral'), icon: 'solar:global-bold-duotone' },
    { value: 'storage', label: t('settings.tabStorage'), icon: 'solar:database-bold-duotone' },
  ];

  const aiNavItems: AiConfigNavItem[] = [
    { value: 'llm', label: t('settings.aiNav.llm'), icon: 'solar:chat-round-dots-bold' },
    { value: 'asr', label: t('settings.aiNav.asr'), icon: 'solar:subtitles-bold-duotone' },
    { value: 'embedding', label: t('settings.aiNav.embedding'), icon: 'eva:search-fill' },
  ];

  return (
    <DashboardContent maxWidth="lg">
      <Typography variant="h4" sx={{ mb: { xs: 3, md: 4 } }}>
        {t('settings.title')}
      </Typography>

      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <SettingsTabs value={tab} onChange={(v) => setTab(v as SettingsTab)} tabs={tabs} />
      </Box>

      {tab === 'ai' && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 3 }}>
            <AiConfigNav value={aiSection} onChange={setAiSection} items={aiNavItems} />
          </Grid>

          <Grid size={{ xs: 12, md: 9 }}>
            {aiSection === 'llm' && (
              <LlmConfigCard
                settings={s.settings}
                currentProviderDef={s.currentProviderDef}
                currentLlmApiKey={s.currentLlmApiKey}
                currentLlmModel={s.currentLlmModel}
                isCustomProvider={s.isCustomProvider}
                saved={s.saved}
                updateLlm={s.updateLlm}
              />
            )}

            {aiSection === 'asr' && (
              <AsrConfigCard
                settings={s.settings}
                currentAsrDef={s.currentAsrDef}
                currentAsrApiKey={s.currentAsrApiKey}
                currentAsrModel={s.currentAsrModel}
                updateAsr={s.updateAsr}
              />
            )}

            {aiSection === 'embedding' && (
              <EmbeddingConfigCard
                currentEmbeddingDef={s.currentEmbeddingDef}
                currentEmbeddingApiKey={s.currentEmbeddingApiKey}
                currentEmbeddingBaseUrl={s.currentEmbeddingBaseUrl}
                currentEmbeddingModel={s.currentEmbeddingModel}
                currentEmbeddingDimensions={s.currentEmbeddingDimensions}
                updateEmbedding={s.updateEmbedding}
              />
            )}
          </Grid>
        </Grid>
      )}

      {tab === 'general' && (
        <Grid container spacing={3}>
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
      )}

      {tab === 'storage' && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 6 }}>
            <ExportCard />
          </Grid>
        </Grid>
      )}
    </DashboardContent>
  );
}
