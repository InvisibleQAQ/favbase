import type { LLMProviderId, ASRProviderId } from './providers';

/** Single subtitle line with timing info. */
export interface SubtitleRow {
  /** Start time in seconds. */
  start: number;
  /** End time in seconds. */
  end: number;
  /** Subtitle text content. */
  text: string;
}

export interface SubtitleResult {
  status: 'ok' | 'no_subtitle' | 'error';
  rows: SubtitleRow[];
  source?: 'bilibili' | 'groq';
  error?: string;
}

/** Raw subtitle item from Bilibili API (before processing). */
export interface RawSubtitleItem {
  from: number;
  to: number;
  content: string;
}

export type SdkType = 'openai' | 'anthropic' | 'google' | 'openai-compatible';

/** Static definition of a LLM provider (immutable config). */
export interface LLMProviderDef {
  id: LLMProviderId;
  name: string;
  sdkType: SdkType;
  baseUrl: string;
  defaultModel: string;
  regUrl: string;
}

/** Static definition of an ASR provider. */
export interface ASRProviderDef {
  id: ASRProviderId;
  name: string;
  defaultModel: string;
}

/** User-configurable settings (persisted to storage). */
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
