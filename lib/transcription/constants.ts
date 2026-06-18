export const GROQ_TRANSCRIBE_URL =
  'https://api.groq.com/openai/v1/audio/transcriptions';

export const GROQ_MODELS_URL =
  'https://api.groq.com/openai/v1/models';

export const GROQ_MAX_AUDIO_BYTES = 24 * 1024 * 1024; // 24 MB

export const GROQ_DEFAULT_MODEL = 'whisper-large-v3-turbo';

export const GROQ_TRANSCRIPTION_PROMPT =
  '只转写音频里真实说出的中文内容，并输出带时间戳的中文字幕。';

export const ASR_TASK_TIMEOUT_MS = 60_000;

export const ASR_CONNECTIVITY_TIMEOUT_MS = 6_000;

export const CHUNK_SECONDS = 600;

export const CHUNK_OVERLAP_SECONDS = 4;

export const MIN_CHUNK_SECONDS = 45;

export const CHUNK_SIZE_SAFETY_RATIO = 0.72;

export const CHUNK_SHRINK_FACTOR = 0.7;

export const MAX_CHUNK_SHRINK_ROUNDS = 3;

export const AUDIO_FINGERPRINT_LRU_SIZE = 30;

export const AUDIO_FILE_NAME = 'audio.m4a';

export const AUDIO_MIME_TYPE = 'audio/mp4';

export const PROGRESS = {
  START: 5,
  CONNECTIVITY_CHECK: 12,
  DOWNLOAD_BEGIN: 20,
  DOWNLOAD_END: 55,
  PREPARE_UPLOAD: 56,
  CHUNK_PREPARE: 58,
  CHUNK_TRANSCRIBE_BEGIN: 62,
  CHUNK_TRANSCRIBE_END: 86,
  UPLOAD_BEGIN: 55,
  UPLOAD_END: 88,
  PARSING: 90,
  DONE: 100,
} as const;
