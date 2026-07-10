import { useTranslation } from '@/lib/i18n/use-translation';
import type { LocalePreference } from '@/lib/storage';
import type { OpenAppPageRequest } from '@/lib/background/messages';

// AI config editing lives exclusively in app.html (draft + test-gated manual
// save); this panel keeps only panel-local preferences (language) plus a jump
// entry. Content scripts have no `browser.tabs` access, so opening/focusing
// the app page is delegated to the background SW.
function openAppSettings() {
  const msg: OpenAppPageRequest = { type: 'OPEN_APP_PAGE', hash: '#/settings' };
  void browser.runtime.sendMessage(msg).catch((err) => {
    console.error('[favbase] failed to open app settings:', err);
  });
}

export function SettingsView() {
  const { t, preference, setLocale } = useTranslation();

  return (
    <div className="favbase-settings">
      {/* --- Language Section --- */}
      <div className="favbase-settings-section">
        <div className="favbase-settings-section-title">{t('settings.language')}</div>
        <select
          className="favbase-settings-select"
          value={preference}
          onChange={(e) => setLocale(e.target.value as LocalePreference)}
        >
          <option value="auto">{t('settings.languageAuto')}</option>
          <option value="zh-CN">{t('settings.languageZhCN')}</option>
          <option value="en">{t('settings.languageEn')}</option>
        </select>
      </div>

      {/* --- AI config moved to app.html --- */}
      <div className="favbase-settings-section">
        <div className="favbase-settings-section-title">{t('panel.aiConfig')}</div>
        <p className="favbase-settings-desc">{t('panel.settingsMoved')}</p>
        <button className="favbase-settings-open-app" type="button" onClick={openAppSettings}>
          {t('panel.openSettings')}
        </button>
      </div>
    </div>
  );
}
