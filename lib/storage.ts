import { storage } from 'wxt/utils/storage';
import type { LLMProviderId, ASRProviderId } from './providers';

export interface UserSettings {
  // LLM
  provider: LLMProviderId;
  providerApiKeys: Record<string, string>;
  providerModels: Record<string, string>;
  customBaseUrl: string;
  customModel: string;
  customProtocol: 'openai' | 'claude';

  // ASR
  asrProvider: ASRProviderId;
  groqApiKey: string;
  groqModel: string;
  siliconFlowApiKey: string;
  siliconFlowAsrModel: string;

  // Mode
  prefMode: 'quality' | 'efficiency';

  // Advanced
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  // LLM
  provider: 'modelscope',
  providerApiKeys: {},
  providerModels: {},
  customBaseUrl: '',
  customModel: '',
  customProtocol: 'openai',

  // ASR
  asrProvider: 'groq',
  groqApiKey: '',
  groqModel: 'whisper-large-v3-turbo',
  siliconFlowApiKey: '',
  siliconFlowAsrModel: 'FunAudioLLM/SenseVoiceSmall',

  // Mode
  prefMode: 'efficiency',

  // Advanced
  temperature: 0.3,
  maxTokens: 1000,
};

export const settingsStorage = storage.defineItem<UserSettings>(
  'local:settings',
  { fallback: DEFAULT_SETTINGS },
);

export const sidebarPinnedStorage = storage.defineItem<boolean>(
  'local:sidebarPinned',
  { fallback: true },
);
