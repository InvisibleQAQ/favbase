import { FFmpeg } from '@ffmpeg/ffmpeg';
import type { SubtitleRow } from '@/lib/subtitle/types';
import { createErrorInfo } from '@/lib/transcription/types';
import type {
  OffscreenPrepareRequest,
  OffscreenTranscribeRequest,
  SubsystemState,
  ChunkPlan,
} from './types';
import {
  CHUNK_OVERLAP_SECONDS,
  MIN_CHUNK_SECONDS,
  CHUNK_SHRINK_FACTOR,
  MAX_CHUNK_SHRINK_ROUNDS,
  AUDIO_MIME_TYPE,
} from '@/lib/transcription/constants';
import { requestGroqTranscription } from '@/lib/transcription/groq-client';
import { sendOffscreenProgress } from './client';
import {
  estimateSafeChunkSeconds,
  buildOverlappedChunkPlan,
  mergeTimestampedChunkRows,
} from './chunking';

const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

let status: SubsystemState = 'pending';

export function getState(): SubsystemState {
  return status;
}

let ffmpegLock: Promise<void> = Promise.resolve();

function withFfmpegLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = ffmpegLock;
  let resolve: () => void;
  ffmpegLock = new Promise((r) => { resolve = r; });
  return prev.catch(() => {}).then(fn).finally(() => { resolve!(); });
}

interface ChunkSession {
  chunks: { bytes: Uint8Array; plan: ChunkPlan }[];
  lastActive: number;
}

const sessions = new Map<string, ChunkSession>();

function touchSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) session.lastActive = Date.now();
}

function sweepStaleSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActive > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

let sweepTimer: ReturnType<typeof setInterval> | undefined;

export function start(): void {
  if (sweepTimer !== undefined) return;
  sweepTimer = setInterval(sweepStaleSessions, SESSION_SWEEP_INTERVAL_MS);
}

export function stop(): void {
  if (sweepTimer === undefined) return;
  clearInterval(sweepTimer);
  sweepTimer = undefined;
}

let ffmpegPromise: Promise<FFmpeg> | null = null;

function resetFFmpeg(): void {
  ffmpegPromise = null;
  status = 'pending';
}

function getFFmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const coreURL = chrome.runtime.getURL('/ffmpeg/ffmpeg-core.js');
      const wasmURL = chrome.runtime.getURL('/ffmpeg/ffmpeg-core.wasm');
      await ffmpeg.load({ coreURL, wasmURL });
      status = 'ready';
      return ffmpeg;
    })().catch((err) => {
      ffmpegPromise = null;
      status = 'failed';
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
    throw createErrorInfo('DOWNLOAD_FAILED', `Audio download failed: ${err instanceof Error ? err.message : 'network error'}`, { status: 0 });
  }
  if (!res.ok) {
    throw createErrorInfo('DOWNLOAD_FAILED', `Audio download failed: HTTP ${res.status}`, { status: res.status });
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
    resetFFmpeg();
    return 0;
  } finally {
    await ffmpeg.deleteFile(probeName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

async function splitAudioIntoChunks(
  audioBytes: Uint8Array,
  plans: ChunkPlan[],
): Promise<{ bytes: Uint8Array; plan: ChunkPlan }[]> {
  const ffmpeg = await getFFmpeg();
  const inputName = 'input.m4a';

  try {
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
  } catch (err) {
    resetFFmpeg();
    throw err;
  }
}

async function doPrepare(msg: OffscreenPrepareRequest): Promise<void> {
  const sourceBytes = await fetchAudioBytes(msg.audioUrl);
  const totalBytes = sourceBytes.byteLength;

  let duration: number;
  try {
    duration = await resolveAudioDuration(sourceBytes, AUDIO_MIME_TYPE);
  } catch {
    duration = 0;
  }
  if (!(duration > 0)) {
    throw createErrorInfo('ASR_CHUNK_DURATION_UNKNOWN', 'Cannot determine audio duration');
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
      throw createErrorInfo('ASR_CHUNKING_FAILED', 'FFmpeg chunking failed');
    }

    const oversized = chunks.some((c) => c.bytes.byteLength > msg.maxBytes);
    if (!oversized) break;

    if (round === MAX_CHUNK_SHRINK_ROUNDS) {
      throw createErrorInfo('ASR_CHUNKING_UNSUPPORTED', `Still oversized after ${MAX_CHUNK_SHRINK_ROUNDS} shrink rounds`);
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

  sessions.set(msg.sessionId, { chunks: chunks!, lastActive: Date.now() });
}

async function transcribeChunk(
  chunkBytes: Uint8Array,
  apiKey: string,
  model: string,
  baseUrl: string,
): Promise<SubtitleRow[]> {
  const ab = chunkBytes.buffer.slice(chunkBytes.byteOffset, chunkBytes.byteOffset + chunkBytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: AUDIO_MIME_TYPE });
  const { rows } = await requestGroqTranscription(blob, apiKey, model, undefined, baseUrl);
  return rows;
}

async function doTranscribe(msg: OffscreenTranscribeRequest): Promise<SubtitleRow[]> {
  const session = sessions.get(msg.sessionId);
  if (!session) {
    throw createErrorInfo('ASR_CHUNKING_FAILED', `Chunk session not found: ${msg.sessionId}`);
  }

  touchSession(msg.sessionId);

  let accumulated: SubtitleRow[] = [];
  const total = session.chunks.length;

  for (let i = 0; i < total; i++) {
    touchSession(msg.sessionId);
    const { bytes, plan } = session.chunks[i];

    sendOffscreenProgress({
      type: 'OFFSCREEN_CHUNK_PROGRESS',
      sessionId: msg.sessionId,
      chunkIndex: i,
      totalChunks: total,
    });

    const rows = await transcribeChunk(bytes, msg.apiKey, msg.model, msg.baseUrl);

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

export function prepare(msg: OffscreenPrepareRequest): Promise<void> {
  return withFfmpegLock(() => doPrepare(msg));
}

export function transcribe(msg: OffscreenTranscribeRequest): Promise<SubtitleRow[]> {
  return withFfmpegLock(() => doTranscribe(msg));
}

export function release(sessionId: string): void {
  sessions.delete(sessionId);
}
