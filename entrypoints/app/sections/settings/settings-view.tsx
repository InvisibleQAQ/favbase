import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import Grid from '@mui/material/Grid';
import FormControl from '@mui/material/FormControl';
import InputLabel from '@mui/material/InputLabel';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';

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
import {
  SETTINGS_DEFAULT_PATH,
  SETTINGS_NAV,
  legacySectionPath,
  resolveSettingsRoute,
  settingsTabPath,
  type SettingsLeaf,
} from './settings-nav';

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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { tab: tabParam, section: sectionParam } = useParams();
  const route = resolveSettingsRoute(tabParam, sectionParam);
  const resumePlatform = parseResumePlatform(searchParams.get('resume'));

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

  // `/settings`, a bare tab, an unknown segment and the pre-route
  // `?section=` bookmark all land here and get rewritten to a canonical leaf.
  // `replace` on purpose: a redirect must never sit in history as a stop the
  // back button can return to. `?resume=` rides along — it is a one-shot side
  // effect parameter, not a position, so it survives every internal move too.
  if (!route) {
    const rest = new URLSearchParams(searchParams);
    rest.delete('section');
    const search = rest.toString();
    const pathname =
      settingsTabPath(tabParam) ??
      legacySectionPath(searchParams.get('section')) ??
      SETTINGS_DEFAULT_PATH;
    return <Navigate to={{ pathname, search: search ? `?${search}` : '' }} replace />;
  }

  // Manual tab/rail clicks push, so Back walks section by section.
  const go = (pathname: string) => navigate({ pathname, search: searchParams.toString() ? `?${searchParams}` : '' });

  const activeTab = SETTINGS_NAV.find((entry) => entry.tab === route.tab)!;

  const tabs: SettingsTabItem[] = SETTINGS_NAV.map((entry) => ({
    value: entry.tab,
    label: t(entry.label),
    icon: entry.icon,
  }));

  const railItems: SectionRailItem[] = activeTab.sections.map((item) => ({
    value: item.id,
    label: t(item.label),
    icon: item.icon,
  }));

  return (
    <DashboardContent maxWidth="lg">
      <SectionTitleBar
        title={t('settings.title')}
        links={[{ name: t('breadcrumbs.home'), href: '/' }, { name: t('settings.title') }]}
      />

      <SettingsTabs
        value={route.tab}
        onChange={(value) => {
          const path = settingsTabPath(value);
          if (path) go(path);
        }}
        tabs={tabs}
        ariaLabel={t('settings.title')}
      />

      <RailLayout
        rail={
          <SectionRail
            value={route.section}
            onChange={(value) => go(`/settings/${route.tab}/${value}`)}
            items={railItems}
            ariaLabel={t(activeTab.label)}
          />
        }
      >
        {renderSection(route.leaf)}
      </RailLayout>
    </DashboardContent>
  );

  // One flat switch over the enumerated leaves — the `never` default makes
  // `tsc` name a section added to SETTINGS_NAV but left unrendered.
  function renderSection(leaf: SettingsLeaf): ReactNode {
    switch (leaf) {
      case 'ai/llm':
        return <LlmConfigCard settings={s.settings} saveLlm={saveLlm} />;
      case 'ai/asr':
        return <AsrConfigCard settings={s.settings} saveAsr={s.saveAsr} />;
      case 'ai/embedding':
        return <EmbeddingConfigCard settings={s.settings} saveEmbedding={saveEmbedding} />;
      case 'connections/github':
        return <GithubConnectionCard settings={s.settings} saveGithub={s.saveGithub} />;
      case 'connections/youtube':
        return <YoutubeConnectionCard settings={s.settings} saveYoutube={s.saveYoutube} />;
      case 'connections/agent-bridge':
        return <AgentBridgeCard />;
      case 'general/language':
        return (
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
        );
      case 'storage/export':
        return <ExportCard />;
      case 'storage/webdav':
        return <WebdavSyncCard />;
      default: {
        const exhaustive: never = leaf;
        return exhaustive;
      }
    }
  }
}
