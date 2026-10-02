import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';

import type { LocaleKeys } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n/use-translation';
import { settingsPath, type SettingsLeaf } from '../../sections/settings/settings-nav';
import { Iconify, type IconifyName } from '../iconify';
// Leaf files, not the `../collection` barrel: the barrel carries the scaffold,
// which imports this directory's chrome-copy hook and the library gate (a
// load-time storage read). Two dumb components need none of that.
import { StateBox } from '../collection/state-box';
import { SyncNowButton } from '../collection/sync-now-button';

/** The platform's own site, opened in a new tab: X's bookmarks page, zhihu.com.
 *  Logging in there is how favbase gets the session the sync then rides on. */
export interface SiteAction {
  href: string;
  label: LocaleKeys;
  icon: IconifyName;
}

interface SyncAction {
  syncing: boolean;
  onSync: () => void;
}

interface GuideStateProps {
  icon: IconifyName;
  title: LocaleKeys;
  description: LocaleKeys;
  /** Leading action (open the site / go to Settings). */
  lead?: ReactNode;
  /** In-app Fetch. */
  sync?: SyncAction;
}

/**
 * The anatomy every guide state shares: 48px secondary glyph, translated title
 * and description, and at most a leading action plus Fetch. Fetch is
 * `contained` only when it stands alone — then it IS the path forward; next to
 * a leading action it steps back to `outlined` (the `SyncNowButton` contract).
 */
function GuideState({ icon, title, description, lead, sync }: GuideStateProps) {
  const { t } = useTranslation();

  const fetch = sync ? (
    <SyncNowButton
      syncing={sync.syncing}
      onSync={sync.onSync}
      label={t('pipeline.fetchNow')}
      variant={lead ? 'outlined' : 'contained'}
    />
  ) : null;

  let action: ReactNode = lead ?? fetch;
  if (lead && fetch) {
    action = (
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, flexWrap: 'wrap' }}>
        {lead}
        {fetch}
      </Box>
    );
  }

  return (
    <StateBox
      icon={<Iconify icon={icon} width={48} sx={{ color: 'text.secondary' }} />}
      title={t(title)}
      description={t(description)}
      action={action}
    />
  );
}

function OpenSiteButton({ href, label, icon }: SiteAction) {
  const { t } = useTranslation();
  return (
    <Button
      component={Link}
      href={href}
      target="_blank"
      rel="noopener"
      variant="contained"
      color="primary"
      startIcon={<Iconify icon={icon} width={18} />}
    >
      {t(label)}
    </Button>
  );
}

/** A click, not a link: the configuration-gate test clicks it and reads the
 *  router location afterwards. */
function GoToSettingsButton({ settings }: { settings: SettingsLeaf }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <Button variant="contained" color="primary" onClick={() => navigate(settingsPath(settings))}>
      {t('common.goToSettings')}
    </Button>
  );
}

export interface EmptyLibraryStateProps extends SyncAction {
  icon: IconifyName;
  title: LocaleKeys;
  description: LocaleKeys;
  /** Opening the platform's site comes first when that is how the library fills (X). */
  site?: SiteAction;
}

/** Never synced, or synced empty: guide the user to Fetch. */
export function EmptyLibraryState({
  icon,
  title,
  description,
  syncing,
  onSync,
  site,
}: EmptyLibraryStateProps) {
  return (
    <GuideState
      icon={icon}
      title={title}
      description={description}
      lead={site ? <OpenSiteButton {...site} /> : undefined}
      sync={{ syncing, onSync }}
    />
  );
}

export interface NotLoggedInStateProps extends SyncAction {
  icon: IconifyName;
  /** The view picks the copy (X tells a missing session from a rejected one). */
  title: LocaleKeys;
  description: LocaleKeys;
  site: SiteAction;
}

/** No usable site session: log in on the platform's site, then Fetch here. */
export function NotLoggedInState({
  icon,
  title,
  description,
  site,
  syncing,
  onSync,
}: NotLoggedInStateProps) {
  return (
    <GuideState
      icon={icon}
      title={title}
      description={description}
      lead={<OpenSiteButton {...site} />}
      sync={{ syncing, onSync }}
    />
  );
}

export interface NeedsConfigStateProps {
  icon: IconifyName;
  title: LocaleKeys;
  description: LocaleKeys;
  /** The Connections card that fixes it. */
  settings: SettingsLeaf;
  /** Present when the credential exists but was rejected — retry after fixing it.
   *  Absent when nothing is configured yet (nothing to retry). */
  sync?: SyncAction;
}

/** A credential the user enters in Settings is missing or was rejected. */
export function NeedsConfigState({ icon, title, description, settings, sync }: NeedsConfigStateProps) {
  return (
    <GuideState
      icon={icon}
      title={title}
      description={description}
      lead={<GoToSettingsButton settings={settings} />}
      sync={sync}
    />
  );
}
