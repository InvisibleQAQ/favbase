import { useState } from 'react';
import type { LLMProviderDef, ASRProviderDef, UserSettings } from '@/lib/types';
import { LLM_PROVIDERS, ASR_PROVIDERS, type LLMProviderId, type ASRProviderId } from '@/lib/providers';
import { t } from '@/lib/i18n';

export interface SettingsViewProps {
  settings: UserSettings;
  saved: boolean;

  currentProviderDef: LLMProviderDef;
  currentLlmApiKey: string;
  currentLlmModel: string;
  isCustomProvider: boolean;

  currentAsrDef: ASRProviderDef;
  currentAsrApiKey: string;
  currentAsrModel: string;

  switchProvider: (id: LLMProviderId) => void;
  updateLlmApiKey: (key: string) => void;
  updateLlmModel: (model: string) => void;
  updateCustomBaseUrl: (url: string) => void;
  updateCustomProtocol: (protocol: 'openai' | 'claude') => void;

  switchAsrProvider: (id: ASRProviderId) => void;
  updateAsrApiKey: (key: string) => void;
  updateAsrModel: (model: string) => void;

  updatePrefMode: (mode: 'quality' | 'efficiency') => void;
}

export function SettingsView({
  settings,
  saved,
  currentProviderDef,
  currentLlmApiKey,
  currentLlmModel,
  isCustomProvider,
  currentAsrDef,
  currentAsrApiKey,
  currentAsrModel,
  switchProvider,
  updateLlmApiKey,
  updateLlmModel,
  updateCustomBaseUrl,
  updateCustomProtocol,
  switchAsrProvider,
  updateAsrApiKey,
  updateAsrModel,
  updatePrefMode,
}: SettingsViewProps) {
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showAsrKey, setShowAsrKey] = useState(false);

  return (
    <div className="favbase-settings">
      {saved && <div className="favbase-settings-saved">{t('settings.saved')}</div>}

      {/* --- LLM Section --- */}
      <div className="favbase-settings-section">
        <div className="favbase-settings-section-title">{t('settings.llm')}</div>

        <label className="favbase-settings-label">{t('settings.llmProvider')}</label>
        <select
          className="favbase-settings-select"
          value={settings.provider}
          onChange={(e) => switchProvider(e.target.value as LLMProviderId)}
        >
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label className="favbase-settings-label">
          {t('settings.apiKey')}
          {currentProviderDef.regUrl && (
            <a
              className="favbase-settings-link"
              href={currentProviderDef.regUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t('settings.getKey')}
            </a>
          )}
        </label>
        <div className="favbase-settings-input-group">
          <input
            className="favbase-settings-input"
            type={showLlmKey ? 'text' : 'password'}
            placeholder={t('settings.apiKeyPlaceholder')}
            value={currentLlmApiKey}
            onChange={(e) => updateLlmApiKey(e.target.value)}
          />
          <button
            className="favbase-settings-toggle"
            type="button"
            onClick={() => setShowLlmKey((v) => !v)}
          >
            {showLlmKey ? t('settings.hide') : t('settings.show')}
          </button>
        </div>

        <label className="favbase-settings-label">{t('settings.model')}</label>
        <input
          className="favbase-settings-input"
          type="text"
          placeholder={currentProviderDef.defaultModel || t('settings.modelPlaceholder')}
          value={currentLlmModel}
          onChange={(e) => updateLlmModel(e.target.value)}
        />

        {isCustomProvider && (
          <>
            <label className="favbase-settings-label">{t('settings.customBaseUrl')}</label>
            <input
              className="favbase-settings-input"
              type="text"
              placeholder={t('settings.customBaseUrlPlaceholder')}
              value={settings.customBaseUrl}
              onChange={(e) => updateCustomBaseUrl(e.target.value)}
            />

            <label className="favbase-settings-label">{t('settings.customProtocol')}</label>
            <select
              className="favbase-settings-select"
              value={settings.customProtocol}
              onChange={(e) =>
                updateCustomProtocol(e.target.value as 'openai' | 'claude')
              }
            >
              <option value="openai">OpenAI</option>
              <option value="claude">Claude</option>
            </select>
          </>
        )}
      </div>

      {/* --- ASR Section --- */}
      <div className="favbase-settings-section">
        <div className="favbase-settings-section-title">{t('settings.asr')}</div>

        <label className="favbase-settings-label">{t('settings.asrProvider')}</label>
        <select
          className="favbase-settings-select"
          value={settings.asrProvider}
          onChange={(e) => switchAsrProvider(e.target.value as ASRProviderId)}
        >
          {ASR_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        <label className="favbase-settings-label">{t('settings.apiKey')}</label>
        <div className="favbase-settings-input-group">
          <input
            className="favbase-settings-input"
            type={showAsrKey ? 'text' : 'password'}
            placeholder={t('settings.apiKeyPlaceholder')}
            value={currentAsrApiKey}
            onChange={(e) => updateAsrApiKey(e.target.value)}
          />
          <button
            className="favbase-settings-toggle"
            type="button"
            onClick={() => setShowAsrKey((v) => !v)}
          >
            {showAsrKey ? t('settings.hide') : t('settings.show')}
          </button>
        </div>

        <label className="favbase-settings-label">{t('settings.model')}</label>
        <input
          className="favbase-settings-input"
          type="text"
          placeholder={currentAsrDef.defaultModel}
          value={currentAsrModel}
          onChange={(e) => updateAsrModel(e.target.value)}
        />
      </div>

      {/* --- Mode Section --- */}
      <div className="favbase-settings-section">
        <div className="favbase-settings-section-title">{t('settings.mode')}</div>

        <div className="favbase-settings-mode-group">
          <label className="favbase-settings-mode-option">
            <input
              type="radio"
              name="prefMode"
              value="quality"
              checked={settings.prefMode === 'quality'}
              onChange={() => updatePrefMode('quality')}
            />
            <div className="favbase-settings-mode-content">
              <span className="favbase-settings-mode-label">{t('settings.modeQuality')}</span>
              <span className="favbase-settings-mode-desc">{t('settings.modeQualityDesc')}</span>
            </div>
          </label>

          <label className="favbase-settings-mode-option">
            <input
              type="radio"
              name="prefMode"
              value="efficiency"
              checked={settings.prefMode === 'efficiency'}
              onChange={() => updatePrefMode('efficiency')}
            />
            <div className="favbase-settings-mode-content">
              <span className="favbase-settings-mode-label">{t('settings.modeEfficiency')}</span>
              <span className="favbase-settings-mode-desc">{t('settings.modeEfficiencyDesc')}</span>
            </div>
          </label>
        </div>
      </div>
    </div>
  );
}
