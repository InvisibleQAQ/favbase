export type SdkType = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

export const LLM_PROVIDER_IDS = [
  'modelscope', 'zhipu', 'gemini', 'openai', 'openrouter',
  'deepseek', 'kimi', 'claude', 'custom',
] as const;
export type LLMProviderId = typeof LLM_PROVIDER_IDS[number];

export const ASR_PROVIDER_IDS = ['groq', 'siliconflow'] as const;
export type ASRProviderId = typeof ASR_PROVIDER_IDS[number];

export interface LLMProviderDef {
  id: LLMProviderId;
  name: string;
  sdkType: SdkType;
  baseUrl: string;
  defaultModel: string;
  regUrl: string;
  /** Endpoint accepts `response_format: json_schema` (unset = conservative json_object). */
  supportsJsonSchema?: boolean;
}

export interface ASRProviderDef {
  id: ASRProviderId;
  name: string;
  defaultModel: string;
  baseUrl: string;
}

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
    // Gateway natively accepts json_schema and silently downgrades to
    // json_object for upstreams that lack it (never 400s).
    supportsJsonSchema: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    sdkType: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/',
    // Legacy 'deepseek-chat' alias retires 2026-07-24; it already routes here.
    defaultModel: 'deepseek-v4-flash',
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
    baseUrl: 'https://api.groq.com/openai/v1',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
    baseUrl: 'https://api.siliconflow.cn/v1',
  },
];

export function getAsrProviderDef(id: ASRProviderId): ASRProviderDef {
  return ASR_PROVIDERS.find((p) => p.id === id) ?? ASR_PROVIDERS[0];
}

export const EMBEDDING_PROVIDER_IDS = [
  'openai', 'gemini', 'zhipu', 'siliconflow', 'ollama', 'custom',
] as const;
export type EmbeddingProviderId = typeof EMBEDDING_PROVIDER_IDS[number];

export interface EmbeddingProviderDef {
  id: EmbeddingProviderId;
  name: string;
  sdkType: SdkType;
  baseUrl: string;
  defaultModel: string;
  regUrl: string;
}

export const EMBEDDING_PROVIDERS: EmbeddingProviderDef[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    sdkType: 'openai',
    baseUrl: 'https://api.openai.com/v1/',
    defaultModel: 'text-embedding-3-small',
    regUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    sdkType: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
    defaultModel: 'text-embedding-004',
    regUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'zhipu',
    name: 'ZhiPu AI',
    sdkType: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    defaultModel: 'embedding-3',
    regUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    sdkType: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.cn/v1',
    defaultModel: 'BAAI/bge-m3',
    regUrl: '',
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    sdkType: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    defaultModel: 'nomic-embed-text',
    regUrl: '',
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

export function getEmbeddingProviderDef(id: EmbeddingProviderId): EmbeddingProviderDef {
  return EMBEDDING_PROVIDERS.find((p) => p.id === id) ?? EMBEDDING_PROVIDERS[0];
}
