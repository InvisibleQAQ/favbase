import { useState } from 'react';
import type { UserSettings } from '@/lib/types';
import { LLM_PROVIDERS, ASR_PROVIDERS, getProviderDef, type LLMProviderId, type ASRProviderId } from '@/lib/providers';
import { t } from '@/lib/i18n';

interface SettingsViewProps {
  settings: UserSettings;
  onUpdate: (patch: Partial<UserSettings>) => void;
  saved: boolean;
}

export function SettingsView({ settings, onUpdate, saved }: SettingsViewProps) {
  const [showLlmKey, setShowLlmKey] = useState(false);
  const [showAsrKey, setShowAsrKey] = useState(false);

  const currentProvider = getProviderDef(settings.provider);
  const currentLlmKey = settings.providerApiKeys[settings.provider] ?? '';
  const currentLlmModel =
    settings.providerModels[settings.provider] ?? currentProvider.defaultModel;

  const isCustom = settings.provider === 'custom';

  // Current ASR provider values
  const isGroq = settings.asrProvider === 'groq';
  const currentAsrKey = isGroq ? settings.groqApiKey : settings.siliconFlowApiKey;
  const currentAsrModel = isGroq ? settings.groqModel : settings.siliconFlowAsrModel;
  const asrDef = ASR_PROVIDERS.find((p) => p.id === settings.asrProvider) ?? ASR_PROVIDERS[0];

  return (
    <div className="favbase-settings">
      {/* Save indicator */}
      {saved && <div className="favbase-settings-saved">{t('settings.saved')}</div>}

      {/* --- LLM Section --- */}
      <div className="favbase-settings-section">
        <div className="favbase-settings-section-title">{t('settings.llm')}</div>

        {/* Provider select */}
        <label className="favbase-settings-label">{t('settings.llmProvider')}</label>
        <select
          className="favbase-settings-select"
          value={settings.provider}
          onChange={(e) => onUpdate({ provider: e.target.value as LLMProviderId })}
        >
          {LLM_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* API Key */}
        <label className="favbase-settings-label">
          {t('settings.apiKey')}
          {currentProvider.regUrl && (
            <a
              className="favbase-settings-link"
              href={currentProvider.regUrl}
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
            value={currentLlmKey}
            onChange={(e) =>
              onUpdate({
                providerApiKeys: {
                  ...settings.providerApiKeys,
                  [settings.provider]: e.target.value,
                },
              })
            }
          />
          <button
            className="favbase-settings-toggle"
            type="button"
            onClick={() => setShowLlmKey((v) => !v)}
          >
            {showLlmKey ? t('settings.hide') : t('settings.show')}
          </button>
        </div>

        {/* Model */}
        <label className="favbase-settings-label">{t('settings.model')}</label>
        <input
          className="favbase-settings-input"
          type="text"
          placeholder={currentProvider.defaultModel || t('settings.modelPlaceholder')}
          value={currentLlmModel}
          onChange={(e) =>
            onUpdate({
              providerModels: {
                ...settings.providerModels,
                [settings.provider]: e.target.value,
              },
            })
          }
        />

        {/* Custom-only fields */}
        {isCustom && (
          <>
            <label className="favbase-settings-label">{t('settings.customBaseUrl')}</label>
            <input
              className="favbase-settings-input"
              type="text"
              placeholder={t('settings.customBaseUrlPlaceholder')}
              value={settings.customBaseUrl}
              onChange={(e) => onUpdate({ customBaseUrl: e.target.value })}
            />

            <label className="favbase-settings-label">{t('settings.customProtocol')}</label>
            <select
              className="favbase-settings-select"
              value={settings.customProtocol}
              onChange={(e) =>
                onUpdate({ customProtocol: e.target.value as 'openai' | 'claude' })
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

        {/* ASR Provider select */}
        <label className="favbase-settings-label">{t('settings.asrProvider')}</label>
        <select
          className="favbase-settings-select"
          value={settings.asrProvider}
          onChange={(e) =>
            onUpdate({ asrProvider: e.target.value as ASRProviderId })
          }
        >
          {ASR_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* ASR API Key */}
        <label className="favbase-settings-label">{t('settings.apiKey')}</label>
        <div className="favbase-settings-input-group">
          <input
            className="favbase-settings-input"
            type={showAsrKey ? 'text' : 'password'}
            placeholder={t('settings.apiKeyPlaceholder')}
            value={currentAsrKey}
            onChange={(e) => {
              if (isGroq) {
                onUpdate({ groqApiKey: e.target.value });
              } else {
                onUpdate({ siliconFlowApiKey: e.target.value });
              }
            }}
          />
          <button
            className="favbase-settings-toggle"
            type="button"
            onClick={() => setShowAsrKey((v) => !v)}
          >
            {showAsrKey ? t('settings.hide') : t('settings.show')}
          </button>
        </div>

        {/* ASR Model */}
        <label className="favbase-settings-label">{t('settings.model')}</label>
        <input
          className="favbase-settings-input"
          type="text"
          placeholder={asrDef.defaultModel}
          value={currentAsrModel}
          onChange={(e) => {
            if (isGroq) {
              onUpdate({ groqModel: e.target.value });
            } else {
              onUpdate({ siliconFlowAsrModel: e.target.value });
            }
          }}
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
              onChange={() => onUpdate({ prefMode: 'quality' })}
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
              onChange={() => onUpdate({ prefMode: 'efficiency' })}
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
