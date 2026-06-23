import type { LLMProviderDef, ASRProviderDef } from './types';

export const LLM_PROVIDER_IDS = [
  'modelscope', 'zhipu', 'gemini', 'openai', 'openrouter',
  'deepseek', 'kimi', 'claude', 'custom',
] as const;
export type LLMProviderId = typeof LLM_PROVIDER_IDS[number];

export const ASR_PROVIDER_IDS = ['groq', 'siliconflow'] as const;
export type ASRProviderId = typeof ASR_PROVIDER_IDS[number];

export const LLM_PROVIDERS: LLMProviderDef[] = [
  {
    id: 'modelscope',
    name: 'ModelScope',
    sdkType: 'openai-compatible',
    baseUrl: 'https://api-inference.modelscope.cn/v1/',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    regUrl: 'https://modelscope.cn/my/myaccesstoken',
  },
  {
    id: 'zhipu',
    name: 'ZhiPu AI',
    sdkType: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    defaultModel: 'glm-4-flash',
    regUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    sdkType: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
    defaultModel: 'gemini-2.0-flash',
    regUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    sdkType: 'openai',
    baseUrl: 'https://api.openai.com/v1/',
    defaultModel: 'gpt-4o-mini',
    regUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    sdkType: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1/',
    defaultModel: 'openrouter/auto',
    regUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    sdkType: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/',
    defaultModel: 'deepseek-chat',
    regUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    name: 'Moonshot (Kimi)',
    sdkType: 'openai-compatible',
    baseUrl: 'https://api.moonshot.cn/v1/',
    defaultModel: 'moonshot-v1-8k',
    regUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'claude',
    name: 'Claude',
    sdkType: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    regUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'custom',
    name: 'Custom',
    sdkType: 'openai-compatible',
    baseUrl: '',
    defaultModel: '',
    regUrl: '',
  },
];

/** Lookup a provider def by id. Falls back to the first provider. */
export function getProviderDef(id: LLMProviderId): LLMProviderDef {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? LLM_PROVIDERS[0];
}

export const ASR_PROVIDERS: ASRProviderDef[] = [
  {
    id: 'groq',
    name: 'Groq',
    defaultModel: 'whisper-large-v3-turbo',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
  },
];
