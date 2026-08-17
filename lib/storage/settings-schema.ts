import { z } from 'zod';
import {
  ASR_PROVIDER_IDS,
  EMBEDDING_PROVIDER_IDS,
  LLM_PROVIDER_IDS,
  type ASRProviderId,
  type EmbeddingProviderId,
  type LLMProviderId,
} from '../providers';

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
  asrConfigs: Record<string, { apiKey: string; model: string }>;

  // Embedding (semantic search)
  embeddingProvider: EmbeddingProviderId;
  /** Raw dimensions are restricted only to finite positive values here. */
  embeddingConfigs: Record<
    string,
    { apiKey: string; baseUrl?: string; model?: string; dimensions?: number }
  >;

  // Platform connections. Missing/empty means not configured.
  githubToken?: string;
  youtubeApiKey?: string;
  youtubeChannel?: string;

  // Mode and advanced generation settings.
  prefMode: 'quality' | 'efficiency';
  temperature: number;
  maxTokens: number;
  /** Per-section manual-save timestamps (ms epoch). */
  configSavedAt?: Partial<Record<'llm' | 'asr' | 'embedding' | 'github' | 'youtube', number>>;
}

function validDefault<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value !== 'string') return fallback;
  return allowed.find((candidate) => candidate === value) ?? fallback;
}

const CUSTOM_PROTOCOLS = ['openai', 'claude'] as const;

export const DEFAULT_SETTINGS: UserSettings = {
  provider: validDefault(import.meta.env.VITE_LLM_PROVIDER, LLM_PROVIDER_IDS, 'modelscope'),
  providerApiKeys: {},
  providerModels: {},
  customBaseUrl:
    typeof import.meta.env.VITE_LLM_BASE_URL === 'string'
      ? import.meta.env.VITE_LLM_BASE_URL
      : '',
  customModel: '',
  customProtocol: validDefault(import.meta.env.VITE_LLM_PROTOCOL, CUSTOM_PROTOCOLS, 'openai'),

  asrProvider: validDefault(import.meta.env.VITE_ASR_PROVIDER, ASR_PROVIDER_IDS, 'groq'),
  asrConfigs: {},

  embeddingProvider: validDefault(
    import.meta.env.VITE_EMBEDDING_PROVIDER,
    EMBEDDING_PROVIDER_IDS,
    'openai',
  ),
  embeddingConfigs: {},

  prefMode: 'efficiency',
  temperature: 0.3,
  maxTokens: 100000,
};

const LEGACY_ASR_FIELDS = [
  'groqApiKey',
  'groqModel',
  'siliconFlowApiKey',
  'siliconFlowAsrModel',
] as const;

function migrateLegacySettings(input: unknown): unknown {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return input;

  const record = input as Record<string, unknown>;
  if (!LEGACY_ASR_FIELDS.some((field) => Object.hasOwn(record, field))) return input;

  const {
    groqApiKey,
    groqModel,
    siliconFlowApiKey,
    siliconFlowAsrModel,
    ...current
  } = record;
  const hasCurrentAsrConfigs = Object.hasOwn(current, 'asrConfigs');
  const currentAsrConfigs = current.asrConfigs;
  if (
    hasCurrentAsrConfigs &&
    (currentAsrConfigs === null ||
      typeof currentAsrConfigs !== 'object' ||
      Array.isArray(currentAsrConfigs))
  ) {
    return current;
  }

  const asrConfigs: Record<string, unknown> = {
    ...((currentAsrConfigs as Record<string, unknown> | undefined) ?? {}),
  };

  if (
    !Object.hasOwn(asrConfigs, 'groq') &&
    (groqApiKey !== undefined || groqModel !== undefined)
  ) {
    asrConfigs.groq = {
      apiKey: groqApiKey === undefined ? '' : groqApiKey,
      model: groqModel === undefined ? '' : groqModel,
    };
  }
  if (
    !Object.hasOwn(asrConfigs, 'siliconflow') &&
    (siliconFlowApiKey !== undefined || siliconFlowAsrModel !== undefined)
  ) {
    asrConfigs.siliconflow = {
      apiKey: siliconFlowApiKey === undefined ? '' : siliconFlowApiKey,
      model: siliconFlowAsrModel === undefined ? '' : siliconFlowAsrModel,
    };
  }

  return { ...current, asrConfigs };
}

const ProviderRecordSchema = z.record(z.string(), z.string());
const AsrConfigSchema = z.object({
  apiKey: z.string(),
  model: z.string(),
}).passthrough();
const EmbeddingConfigSchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  dimensions: z.number().finite().positive().optional(),
}).passthrough();

const UserSettingsSchema = z.object({
  provider: z.enum(LLM_PROVIDER_IDS).default(DEFAULT_SETTINGS.provider),
  providerApiKeys: ProviderRecordSchema.default(() => ({})),
  providerModels: ProviderRecordSchema.default(() => ({})),
  customBaseUrl: z.string().default(DEFAULT_SETTINGS.customBaseUrl),
  customModel: z.string().default(DEFAULT_SETTINGS.customModel),
  customProtocol: z.enum(CUSTOM_PROTOCOLS).default(DEFAULT_SETTINGS.customProtocol),

  asrProvider: z.enum(ASR_PROVIDER_IDS).default(DEFAULT_SETTINGS.asrProvider),
  asrConfigs: z.record(z.string(), AsrConfigSchema).default(() => ({})),

  embeddingProvider: z
    .enum(EMBEDDING_PROVIDER_IDS)
    .default(DEFAULT_SETTINGS.embeddingProvider),
  embeddingConfigs: z.record(z.string(), EmbeddingConfigSchema).default(() => ({})),

  githubToken: z.string().optional(),
  youtubeApiKey: z.string().optional(),
  youtubeChannel: z.string().optional(),

  prefMode: z.enum(['quality', 'efficiency']).default(DEFAULT_SETTINGS.prefMode),
  temperature: z.number().finite().min(0).max(2).default(DEFAULT_SETTINGS.temperature),
  maxTokens: z.number().int().positive().default(DEFAULT_SETTINGS.maxTokens),
  configSavedAt: z.record(z.string(), z.number().finite().nonnegative()).optional(),
}).passthrough();

export interface SettingsValidationIssue {
  path: PropertyKey[];
  message: string;
}

export class SettingsValidationError extends Error {
  readonly issues: SettingsValidationIssue[];

  constructor(issues: SettingsValidationIssue[]) {
    const detail = issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : 'settings'}: ${issue.message}`)
      .join('; ');
    super(`Invalid settings: ${detail}`);
    this.name = 'SettingsValidationError';
    this.issues = issues;
  }
}

export function canonicalizeSettings(input: unknown): UserSettings {
  const result = UserSettingsSchema.safeParse(migrateLegacySettings(input));
  if (!result.success) {
    throw new SettingsValidationError(
      result.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    );
  }
  return result.data;
}
