import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import Grid from '@mui/material/Grid';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Box from '@mui/material/Box';

import { DashboardContent } from '../../layouts/dashboard';
import { isCollectionPlatform, type CollectionPlatform } from '@/lib/collections/platforms';
import { resumeCollectionProcessing } from '../../hooks/collection-processing-resume';
import {
  useSettings,
  type EmbeddingDraft,
  type LlmDraft,
} from '@/lib/hooks/useSettings';
import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocalePreference } from '@/lib/storage';
import { LlmConfigCard } from './llm-config-card';
import { AsrConfigCard } from './asr-config-card';
import { EmbeddingConfigCard } from './embedding/embedding-config-card';
import { GithubConnectionCard } from './github-connection-card';
import { YoutubeConnectionCard } from './youtube-connection-card';
import { AgentBridgeCard } from './agent-bridge-card';
import { ExportCard } from '../overview/export-card';
import { WebdavSyncCard } from './webdav-sync-card';
import { SettingsTabs, type SettingsTabItem } from './settings-tabs';
import { SectionRail, type SectionRailItem } from './section-rail';
import { SectionTitleBar } from '../../components/collection/section-title-bar';
import { SettingsPanel } from './settings-panel';

type SettingsTab = 'ai' | 'connections' | 'general' | 'storage';
type AiSection = 'llm' | 'asr' | 'embedding';
type ConnSection = 'github' | 'youtube' | 'agent-bridge';
type StorageSection = 'export' | 'webdav';

function parseAiSection(value: string | null): AiSection {
  return value === 'asr' || value === 'embedding' || value === 'llm' ? value : 'llm';
}

function parseResumePlatform(value: string | null): CollectionPlatform | null {
  return value != null && isCollectionPlatform(value) ? value : null;
}

/** Every tab shares the same two-column shape: left rail + right content. */
function RailLayout({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <Grid container spacing={{ xs: 2.5, md: 3 }} sx={{ alignItems: 'flex-start' }}>
      <Grid size={{ xs: 12, md: 3 }} sx={{ minWidth: 0 }}>{rail}</Grid>
      <Grid size={{ xs: 12, md: 9 }} sx={{ minWidth: 0 }}>{children}</Grid>
    </Grid>
  );
}

export function SettingsView() {
  const s = useSettings();
  const { t, preference, setLocale } = useTranslation();
  const [searchParams] = useSearchParams();
  const resumePlatform = parseResumePlatform(searchParams.get('resume'));
  const [tab, setTab] = useState<SettingsTab>('ai');
  const [aiSection, setAiSection] = useState<AiSection>(() =>
    parseAiSection(searchParams.get('section')),
  );
  const [connSection, setConnSection] = useState<ConnSection>('github');
  const [storageSection, setStorageSection] = useState<StorageSection>('export');
  const saveLlm = useCallback(
    async (draft: LlmDraft) => {
      await s.saveLlm(draft);
      if (resumePlatform) resumeCollectionProcessing(resumePlatform, 'llm');
    },
    [resumePlatform, s.saveLlm],
  );
  const saveEmbedding = useCallback(
    async (draft: EmbeddingDraft) => {
      await s.saveEmbedding(draft);
      if (resumePlatform) resumeCollectionProcessing(resumePlatform, 'embedding');
    },
    [resumePlatform, s.saveEmbedding],
  );

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
    {
      value: 'agent-bridge',
      label: t('settings.agentBridge.title'),
      icon: 'solar:code-bold-duotone',
    },
  ];

  const generalNavItems: SectionRailItem<'language'>[] = [
    { value: 'language', label: t('settings.language'), icon: 'solar:global-bold-duotone' },
  ];

  const storageNavItems: SectionRailItem<StorageSection>[] = [
    { value: 'export', label: t('export.title'), icon: 'solar:database-bold-duotone' },
    { value: 'webdav', label: t('settings.sync.title'), icon: 'solar:share-bold' },
  ];

  return (
    <DashboardContent maxWidth="lg">
      <SectionTitleBar title={t('settings.title')} />

      <Box sx={{ mb: 3 }}>
        <SettingsTabs
          value={tab}
          onChange={(v) => setTab(v as SettingsTab)}
          tabs={tabs}
          ariaLabel={t('settings.title')}
        />
      </Box>

      {tab === 'ai' && (
        <RailLayout
          rail={
            <SectionRail
              value={aiSection}
              onChange={setAiSection}
              items={aiNavItems}
              ariaLabel={t('settings.tabAi')}
            />
          }
        >
          {aiSection === 'llm' && <LlmConfigCard settings={s.settings} saveLlm={saveLlm} />}
          {aiSection === 'asr' && <AsrConfigCard settings={s.settings} saveAsr={s.saveAsr} />}
          {aiSection === 'embedding' && (
            <EmbeddingConfigCard settings={s.settings} saveEmbedding={saveEmbedding} />
          )}
        </RailLayout>
      )}

      {tab === 'connections' && (
        <RailLayout
          rail={
            <SectionRail
              value={connSection}
              onChange={setConnSection}
              items={connNavItems}
              ariaLabel={t('settings.tabConnections')}
            />
          }
        >
          {connSection === 'github' && (
            <GithubConnectionCard settings={s.settings} saveGithub={s.saveGithub} />
          )}
          {connSection === 'youtube' && (
            <YoutubeConnectionCard settings={s.settings} saveYoutube={s.saveYoutube} />
          )}
          {connSection === 'agent-bridge' && <AgentBridgeCard />}
        </RailLayout>
      )}

      {tab === 'general' && (
        <RailLayout
          rail={
            <SectionRail
              value="language"
              onChange={() => {}}
              items={generalNavItems}
              ariaLabel={t('settings.tabGeneral')}
            />
          }
        >
          <SettingsPanel title={t('settings.language')}>
            <FormControl sx={{ width: 1, maxWidth: 320 }}>
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
          </SettingsPanel>
        </RailLayout>
      )}

      {tab === 'storage' && (
        <RailLayout
          rail={
            <SectionRail
              value={storageSection}
              onChange={setStorageSection}
              items={storageNavItems}
              ariaLabel={t('settings.tabStorage')}
            />
          }
        >
          {storageSection === 'export' && <ExportCard />}
          {storageSection === 'webdav' && <WebdavSyncCard />}
        </RailLayout>
      )}
    </DashboardContent>
  );
}
