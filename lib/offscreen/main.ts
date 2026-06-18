import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { SubtitleRow } from '@/lib/types';
import type {
  OffscreenRequest,
  OffscreenPrepareRequest,
  OffscreenTranscribeRequest,
  ChunkPlan,
  TranscribeErrorInfo,
} from '@/lib/transcription/types';
import {
  CHUNK_SECONDS,
  CHUNK_OVERLAP_SECONDS,
  MIN_CHUNK_SECONDS,
  CHUNK_SIZE_SAFETY_RATIO,
  CHUNK_SHRINK_FACTOR,
  MAX_CHUNK_SHRINK_ROUNDS,
  GROQ_MAX_AUDIO_BYTES,
  GROQ_TRANSCRIBE_URL,
  GROQ_TRANSCRIPTION_PROMPT,
  AUDIO_FILE_NAME,
  AUDIO_MIME_TYPE,
} from '@/lib/transcription/constants';

interface ChunkSession {
  chunks: { bytes: Uint8Array; plan: ChunkPlan }[];
}

const sessions = new Map<string, ChunkSession>();
let ffmpegInstance: FFmpeg | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;

  const ffmpeg = new FFmpeg();
  await ffmpeg.load();
  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

function resolveAudioDuration(audioBytes: Uint8Array): Promise<number> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([audioBytes.buffer.slice(audioBytes.byteOffset, audioBytes.byteOffset + audioBytes.byteLength) as ArrayBuffer], { type: AUDIO_MIME_TYPE });
    const url = URL.createObjectURL(blob);
    const audio = new Audio();

    const cleanup = () => {
      URL.revokeObjectURL(url);
      audio.removeAttribute('src');
      audio.load();
    };

    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      cleanup();
      if (!Number.isFinite(dur) || dur <= 0) {
        reject(new Error('无法确定音频时长'));
      } else {
        resolve(dur);
      }
    });

    audio.addEventListener('error', () => {
      cleanup();
      reject(new Error('无法加载音频以确定时长'));
    });

    audio.src = url;
  });
}

function estimateSafeChunkSeconds(
  totalBytes: number,
  durationSec: number,
  maxBytes: number,
): number {
  const bytesPerSecond = totalBytes / durationSec;
  const raw = Math.floor((maxBytes * CHUNK_SIZE_SAFETY_RATIO) / bytesPerSecond);
  return Math.max(MIN_CHUNK_SECONDS, Math.min(CHUNK_SECONDS, raw));
}

function buildOverlappedChunkPlan(
  totalDuration: number,
  chunkDuration: number,
  overlap: number,
): ChunkPlan[] {
  const step = chunkDuration - overlap;
  const plans: ChunkPlan[] = [];
  let start = 0;
  let index = 0;

  while (start < totalDuration) {
    const remaining = totalDuration - start;

    // If the remaining duration is too short to be a standalone chunk,
    // extend the previous chunk to cover it instead of dropping audio.
    if (remaining < MIN_CHUNK_SECONDS && plans.length > 0) {
      const last = plans[plans.length - 1];
      last.durationSec = totalDuration - last.startSec;
      last.endSec = totalDuration;
      break;
    }

    const dur = Math.min(chunkDuration, remaining);
    plans.push({
      index,
      startSec: start,
      durationSec: dur,
      endSec: start + dur,
    });
    index++;
    start += step;
  }

  return plans;
}

async function splitAudioIntoChunks(
  audioBytes: Uint8Array,
  plans: ChunkPlan[],
): Promise<{ bytes: Uint8Array; plan: ChunkPlan }[]> {
  const ffmpeg = await getFFmpeg();
  const inputName = 'input.m4a';

  await ffmpeg.writeFile(inputName, audioBytes);

  const results: { bytes: Uint8Array; plan: ChunkPlan }[] = [];

  for (const plan of plans) {
    const outputName = `chunk_${plan.index}.m4a`;

    await ffmpeg.exec([
      '-i', inputName,
      '-ss', String(plan.startSec),
      '-t', String(plan.durationSec),
      '-vn',
      '-map', '0:a:0',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputName,
    ]);

    const data = await ffmpeg.readFile(outputName);
    if (typeof data === 'string') {
      throw new Error(`FFmpeg 输出格式错误: chunk ${plan.index}`);
    }

    results.push({ bytes: data, plan });
    await ffmpeg.deleteFile(outputName);
  }

  await ffmpeg.deleteFile(inputName);
  return results;
}

async function handlePrepare(msg: OffscreenPrepareRequest): Promise<void> {
  const audioBytes = new Uint8Array(msg.audioBytes);
  const totalBytes = audioBytes.byteLength;

  let duration: number;
  try {
    duration = await resolveAudioDuration(audioBytes);
  } catch {
    throw {
      code: 'ASR_CHUNK_DURATION_UNKNOWN',
      message: '无法确定音频时长',
    } satisfies TranscribeErrorInfo;
  }

  let chunkSeconds = estimateSafeChunkSeconds(
    totalBytes,
    duration,
    msg.maxBytes,
  );

  let plans = buildOverlappedChunkPlan(
    duration,
    chunkSeconds,
    CHUNK_OVERLAP_SECONDS,
  );

  let chunks: { bytes: Uint8Array; plan: ChunkPlan }[] | null = null;

  for (let round = 0; round <= MAX_CHUNK_SHRINK_ROUNDS; round++) {
    try {
      chunks = await splitAudioIntoChunks(audioBytes, plans);
    } catch {
      throw {
        code: 'ASR_CHUNKING_FAILED',
        message: 'FFmpeg 分块失败',
      } satisfies TranscribeErrorInfo;
    }

    const oversized = chunks.some((c) => c.bytes.byteLength > msg.maxBytes);
    if (!oversized) break;

    if (round === MAX_CHUNK_SHRINK_ROUNDS) {
      throw {
        code: 'ASR_CHUNKING_UNSUPPORTED',
        message: `经过 ${MAX_CHUNK_SHRINK_ROUNDS} 轮缩减仍超限`,
      } satisfies TranscribeErrorInfo;
    }

    chunkSeconds = Math.max(
      MIN_CHUNK_SECONDS,
      Math.floor(chunkSeconds * CHUNK_SHRINK_FACTOR),
    );
    plans = buildOverlappedChunkPlan(
      duration,
      chunkSeconds,
      CHUNK_OVERLAP_SECONDS,
    );
  }

  sessions.set(msg.sessionId, { chunks: chunks! });
}

async function transcribeChunk(
  chunkBytes: Uint8Array,
  apiKey: string,
  model: string,
): Promise<SubtitleRow[]> {
  const file = new File([chunkBytes.buffer.slice(chunkBytes.byteOffset, chunkBytes.byteOffset + chunkBytes.byteLength) as ArrayBuffer], AUDIO_FILE_NAME, { type: AUDIO_MIME_TYPE });
  const formData = new FormData();
  formData.append('file', file);
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  formData.append('prompt', GROQ_TRANSCRIPTION_PROMPT);
  formData.append('timestamp_granularities[]', 'segment');

  const res = await fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after') ?? 30);
    throw {
      code: 'ASR_RATE_LIMIT',
      message: 'Groq API 速率限制',
      retryAfter,
    } satisfies TranscribeErrorInfo;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw {
      code: 'ASR_UNKNOWN',
      message: (body as any)?.error?.message ?? `Groq 错误: HTTP ${res.status}`,
    } satisfies TranscribeErrorInfo;
  }

  const data = await res.json();
  if (!data.segments?.length) return [];

  return data.segments
    .map((seg: { start: number; end: number; text: string }) => {
      const text = seg.text?.trim();
      if (!text) return null;
      return {
        start: Number(seg.start),
        end: Number(seg.end) || Number(seg.start) + 3,
        text,
      };
    })
    .filter(Boolean) as SubtitleRow[];
}

function mergeTimestampedChunkRows(
  accumulated: SubtitleRow[],
  newRows: SubtitleRow[],
  chunkStart: number,
  overlapSec: number,
): SubtitleRow[] {
  const trimThreshold = overlapSec;

  const offsetRows = newRows
    .filter((r) => r.end > trimThreshold || accumulated.length === 0)
    .map((r) => ({
      start: r.start + chunkStart,
      end: r.end + chunkStart,
      text: r.text,
    }));

  if (accumulated.length > 0 && offsetRows.length > 0) {
    const last = accumulated[accumulated.length - 1];
    const first = offsetRows[0];
    if (
      last.text === first.text &&
      Math.abs(last.end - first.start) < 1.5
    ) {
      accumulated[accumulated.length - 1] = {
        ...last,
        end: first.end,
      };
      offsetRows.shift();
    }
  }

  return [...accumulated, ...offsetRows];
}

async function handleTranscribe(msg: OffscreenTranscribeRequest): Promise<SubtitleRow[]> {
  const session = sessions.get(msg.sessionId);
  if (!session) {
    throw {
      code: 'ASR_CHUNKING_FAILED',
      message: '分块会话不存在',
    } satisfies TranscribeErrorInfo;
  }

  let accumulated: SubtitleRow[] = [];
  const total = session.chunks.length;

  for (let i = 0; i < total; i++) {
    const { bytes, plan } = session.chunks[i];

    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_CHUNK_PROGRESS',
      sessionId: msg.sessionId,
      chunkIndex: i,
      totalChunks: total,
    });

    const rows = await transcribeChunk(bytes, msg.apiKey, msg.model);

    if (i === 0) {
      accumulated = rows.map((r) => ({
        start: r.start + plan.startSec,
        end: r.end + plan.startSec,
        text: r.text,
      }));
    } else {
      accumulated = mergeTimestampedChunkRows(
        accumulated,
        rows,
        plan.startSec,
        CHUNK_OVERLAP_SECONDS,
      );
    }
  }

  return accumulated;
}

chrome.runtime.onMessage.addListener(
  (msg: OffscreenRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (msg.type === 'OFFSCREEN_CHUNK_RELEASE') {
      sessions.delete(msg.sessionId);
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === 'OFFSCREEN_CHUNK_PREPARE') {
      handlePrepare(msg)
        .then(() => sendResponse({ success: true }))
        .catch((err) =>
          sendResponse({ success: false, error: err as TranscribeErrorInfo }),
        );
      return true;
    }

    if (msg.type === 'OFFSCREEN_CHUNK_TRANSCRIBE') {
      handleTranscribe(msg)
        .then((rows) => sendResponse({ success: true, rows }))
        .catch((err) =>
          sendResponse({ success: false, error: err as TranscribeErrorInfo }),
        );
      return true;
    }

    return false;
  },
);
