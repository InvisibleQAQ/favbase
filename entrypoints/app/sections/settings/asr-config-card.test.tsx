// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSettings } from '@/lib/storage';

vi.mock('@/lib/storage', () => ({
  DEFAULT_SETTINGS: {},
  settingsStorage: {
    getValue: vi.fn(),
    setValue: vi.fn(),
    watch: vi.fn(() => () => undefined),
  },
  getEnvApiKey: () => '',
  getEnvModel: () => '',
  resolveAsrConfig: (value: UserSettings) => ({
    apiKey: value.asrConfigs[value.asrProvider]?.apiKey ?? '',
    model: value.asrConfigs[value.asrProvider]?.model
      ?? (value.asrProvider === 'groq' ? 'whisper-large-v3-turbo' : 'FunAudioLLM/SenseVoiceSmall'),
    baseUrl: '',
  }),
}));

vi.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
  formatDateTime: (timestamp: number) => String(timestamp),
}));

vi.mock('@/lib/i18n/use-translation', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../components/iconify', () => ({
  Iconify: () => <span aria-hidden="true" />,
}));

import { AsrConfigCard } from './asr-config-card';

function settings(asrProvider: UserSettings['asrProvider']): UserSettings {
  return {
    provider: 'modelscope',
    providerApiKeys: {},
    providerModels: {},
    customBaseUrl: '',
    customModel: '',
    customProtocol: 'openai',
    asrProvider,
    asrConfigs: {},
    embeddingProvider: 'openai',
    embeddingConfigs: {},
    prefMode: 'efficiency',
    temperature: 0.3,
    maxTokens: 100_000,
  };
}

describe('AsrConfigCard Groq quota guidance', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows account-specific free quota guidance only for Groq', () => {
    const saveAsr = vi.fn().mockResolvedValue(undefined);

    act(() => {
      root.render(<AsrConfigCard settings={settings('groq')} saveAsr={saveAsr} />);
    });

    expect(container.textContent).toContain('settings.asr.groqFreeQuotaNote');
    expect(container.querySelector('a')?.href).toBe('https://console.groq.com/settings/limits');

    act(() => {
      root.render(<AsrConfigCard settings={settings('siliconflow')} saveAsr={saveAsr} />);
    });

    expect(container.textContent).not.toContain('settings.asr.groqFreeQuotaNote');
    expect(container.querySelector('a')).toBeNull();
  });
});
