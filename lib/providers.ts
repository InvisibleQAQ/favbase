import type { LLMProviderDef, ASRProviderDef } from './types';

/**
 * LLM providers — mirrors Bilitato's PROVIDERS object exactly.
 * Order matches the Bilitato settings dropdown.
 */
export const LLM_PROVIDERS: LLMProviderDef[] = [
  {
    id: 'modelscope',
    name: 'ModelScope',
    baseUrl: 'https://api-inference.modelscope.cn/v1/',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://modelscope.cn/my/myaccesstoken',
  },
  {
    id: 'zhipu',
    name: 'ZhiPu AI',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    defaultModel: 'glm-4-flash',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
    defaultModel: 'gemini-2.0-flash',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://aistudio.google.com/apikey',
    type: 'google',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1/',
    defaultModel: 'gpt-4o-mini',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1/',
    defaultModel: 'openrouter/auto',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/',
    defaultModel: 'deepseek-chat',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'kimi',
    name: 'Moonshot (Kimi)',
    baseUrl: 'https://api.moonshot.cn/v1/',
    defaultModel: 'moonshot-v1-8k',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'claude',
    name: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-6',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: 'https://console.anthropic.com/settings/keys',
    type: 'claude',
  },
  {
    id: 'custom',
    name: 'Custom',
    baseUrl: '',
    defaultModel: '',
    headerKey: 'Authorization',
    tokenPrefix: 'Bearer ',
    regUrl: '',
  },
];

/** Lookup a provider def by id. Falls back to the first provider. */
export function getProviderDef(id: string): LLMProviderDef {
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
