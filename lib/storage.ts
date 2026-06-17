import { storage } from 'wxt/utils/storage';
import type { UserSettings } from './types';

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
};

export const settingsStorage = storage.defineItem<UserSettings>(
  'local:settings',
  { fallback: DEFAULT_SETTINGS },
);
