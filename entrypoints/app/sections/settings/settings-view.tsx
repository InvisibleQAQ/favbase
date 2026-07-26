import { useState } from 'react';
import type { ReactNode } from 'react';
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
import { EmbeddingConfigCard } from './embedding/embedding-config-card';
import { GithubConnectionCard } from './github-connection-card';
import { YoutubeConnectionCard } from './youtube-connection-card';
import { ExportCard } from '../overview/export-card';
import { SettingsTabs, type SettingsTabItem } from './settings-tabs';
import { SectionRail, type SectionRailItem } from './section-rail';

type SettingsTab = 'ai' | 'connections' | 'general' | 'storage';
type AiSection = 'llm' | 'asr' | 'embedding';
type ConnSection = 'github' | 'youtube';

/** Every tab shares the same two-column shape: left rail + right content. */
function RailLayout({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 3 }}>{rail}</Grid>
      <Grid size={{ xs: 12, md: 9 }}>{children}</Grid>
    </Grid>
  );
}

export function SettingsView() {
  const s = useSettings();
  const { t, preference, setLocale } = useTranslation();
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [aiSection, setAiSection] = useState<AiSection>('llm');
  const [connSection, setConnSection] = useState<ConnSection>('github');

  const tabs: SettingsTabItem[] = [
    { value: 'ai', label: t('settings.tabAi'), icon: 'solar:magic-stick-3-bold-duotone' },
    { value: 'connections', label: t('settings.tabConnections'), icon: 'solar:shield-keyhole-bold-duotone' },
    { value: 'general', label: t('settings.tabGeneral'), icon: 'solar:global-bold-duotone' },
    { value: 'storage', label: t('settings.tabStorage'), icon: 'solar:database-bold-duotone' },
  ];

  const aiNavItems: SectionRailItem<AiSection>[] = [
    { value: 'llm', label: t('settings.aiNav.llm'), icon: 'solar:chat-round-dots-bold' },
    { value: 'asr', label: t('settings.aiNav.asr'), icon: 'solar:subtitles-bold-duotone' },
    { value: 'embedding', label: t('settings.aiNav.embedding'), icon: 'eva:search-fill' },
  ];

  const connNavItems: SectionRailItem<ConnSection>[] = [
    { value: 'github', label: t('settings.github.title'), icon: 'mdi:github' },
    { value: 'youtube', label: t('settings.youtube.title'), icon: 'mdi:youtube' },
  ];

  const generalNavItems: SectionRailItem<'language'>[] = [
    { value: 'language', label: t('settings.language'), icon: 'solar:global-bold-duotone' },
  ];

  const storageNavItems: SectionRailItem<'export'>[] = [
    { value: 'export', label: t('export.title'), icon: 'solar:database-bold-duotone' },
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
        <RailLayout rail={<SectionRail value={aiSection} onChange={setAiSection} items={aiNavItems} />}>
          {aiSection === 'llm' && <LlmConfigCard settings={s.settings} saveLlm={s.saveLlm} />}
          {aiSection === 'asr' && <AsrConfigCard settings={s.settings} saveAsr={s.saveAsr} />}
          {aiSection === 'embedding' && (
            <EmbeddingConfigCard settings={s.settings} saveEmbedding={s.saveEmbedding} />
          )}
        </RailLayout>
      )}

      {tab === 'connections' && (
        <RailLayout rail={<SectionRail value={connSection} onChange={setConnSection} items={connNavItems} />}>
          {connSection === 'github' && (
            <GithubConnectionCard settings={s.settings} saveGithub={s.saveGithub} />
          )}
          {connSection === 'youtube' && (
            <YoutubeConnectionCard settings={s.settings} saveYoutube={s.saveYoutube} />
          )}
        </RailLayout>
      )}

      {tab === 'general' && (
        <RailLayout
          rail={<SectionRail value="language" onChange={() => {}} items={generalNavItems} />}
        >
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
        </RailLayout>
      )}

      {tab === 'storage' && (
        <RailLayout
          rail={<SectionRail value="export" onChange={() => {}} items={storageNavItems} />}
        >
          <ExportCard />
        </RailLayout>
      )}
    </DashboardContent>
  );
}
