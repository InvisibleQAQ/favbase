import { FFmpeg } from '@ffmpeg/ffmpeg';
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
  GROQ_TRANSCRIBE_URL,
  GROQ_TRANSCRIPTION_PROMPT,
  AUDIO_FILE_NAME,
  AUDIO_MIME_TYPE,
} from '@/lib/transcription/constants';
import { initDbMain } from '@/lib/database/db';

interface ChunkSession {
  chunks: { bytes: Uint8Array; plan: ChunkPlan }[];
}

const sessions = new Map<string, ChunkSession>();
let ffmpegPromise: Promise<FFmpeg> | null = null;

function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const coreURL = chrome.runtime.getURL('/ffmpeg/ffmpeg-core.js');
      const wasmURL = chrome.runtime.getURL('/ffmpeg/ffmpeg-core.wasm');
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((err) => {
      ffmpegPromise = null;
      throw err;
    });
  }
  return ffmpegPromise;
}

async function fetchAudioBytes(url: string): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(url, { method: 'GET', credentials: 'omit', mode: 'cors' });
  } catch (err) {
    throw {
      code: 'DOWNLOAD_FAILED',
      message: `Audio download failed: ${err instanceof Error ? err.message : 'network error'}`,
      params: { status: 0 },
    } satisfies TranscribeErrorInfo;
  }
  if (!res.ok) {
    throw {
      code: 'DOWNLOAD_FAILED',
      message: `Audio download failed: HTTP ${res.status}`,
      params: { status: res.status },
    } satisfies TranscribeErrorInfo;
  }
  return res.arrayBuffer();
}

async function resolveAudioDuration(audioBytes: ArrayBuffer, mimeType: string): Promise<number> {
  const fromElement = await readDurationFromAudioElement(audioBytes, mimeType).catch(() => 0);
  if (fromElement > 0) return fromElement;
  const ffmpeg = await getFFmpeg();
  return probeAudioDurationWithFFmpeg(ffmpeg, new Uint8Array(audioBytes));
}

function readDurationFromAudioElement(audioBytes: ArrayBuffer, mimeType: string): Promise<number> {
  return new Promise((resolve) => {
    const blob = new Blob([audioBytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    let settled = false;

    const audio = new Audio();
    const settle = (value: number) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(blobUrl);
      resolve(value);
    };

    audio.addEventListener('loadedmetadata', () => {
      const dur = audio.duration;
      settle(Number.isFinite(dur) && dur > 0 ? dur : 0);
    }, { once: true });
    audio.addEventListener('error', () => settle(0), { once: true });
    setTimeout(() => settle(0), 5000);

    audio.preload = 'metadata';
    audio.src = blobUrl;
  });
}

async function probeAudioDurationWithFFmpeg(ffmpeg: FFmpeg, audioBytes: Uint8Array): Promise<number> {
  const probeName = `probe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.m4a`;
  const outputName = `${probeName}.duration.txt`;
  try {
    await ffmpeg.writeFile(probeName, audioBytes);
    await (ffmpeg as any).ffprobe([
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      probeName,
      '-o', outputName,
    ]);
    const raw = await ffmpeg.readFile(outputName, 'utf8');
    const duration = Number(String(raw || '').trim());
    return Number.isFinite(duration) ? duration : 0;
  } catch {
    return 0;
  } finally {
    await ffmpeg.deleteFile(probeName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
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
      throw new Error(`FFmpeg output format error: chunk ${plan.index}`);
    }

    results.push({ bytes: data, plan });
    await ffmpeg.deleteFile(outputName);
  }

  await ffmpeg.deleteFile(inputName);
  return results;
}

async function handlePrepare(msg: OffscreenPrepareRequest): Promise<void> {
  const sourceBytes = await fetchAudioBytes(msg.audioUrl);
  const totalBytes = sourceBytes.byteLength;

  let duration: number;
  try {
    duration = await resolveAudioDuration(sourceBytes, AUDIO_MIME_TYPE);
  } catch {
    duration = 0;
  }
  if (!(duration > 0)) {
    throw {
      code: 'ASR_CHUNK_DURATION_UNKNOWN',
      message: 'Cannot determine audio duration',
    } satisfies TranscribeErrorInfo;
  }

  const audioBytes = new Uint8Array(sourceBytes);

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
        message: 'FFmpeg chunking failed',
      } satisfies TranscribeErrorInfo;
    }

    const oversized = chunks.some((c) => c.bytes.byteLength > msg.maxBytes);
    if (!oversized) break;

    if (round === MAX_CHUNK_SHRINK_ROUNDS) {
      throw {
        code: 'ASR_CHUNKING_UNSUPPORTED',
        message: `Still oversized after ${MAX_CHUNK_SHRINK_ROUNDS} shrink rounds`,
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
      message: `Groq rate limited (retry after ${retryAfter}s)`,
      retryAfter,
    } satisfies TranscribeErrorInfo;
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const apiMsg = (body as any)?.error?.message ?? `HTTP ${res.status}`;
    throw {
      code: 'ASR_UNKNOWN',
      message: `Groq error: ${apiMsg}`,
      params: { detail: apiMsg },
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
      message: `Chunk session not found: ${msg.sessionId}`,
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

// PGlite initialization (runs alongside FFmpeg, no conflict — different IPC channels)
// FFmpeg: chrome.runtime.onMessage (request/response)
// PGlite RPC: chrome.runtime.onConnect (port-based)
initDbMain().catch((err) => console.error('[offscreen] PGlite init failed:', err));

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
