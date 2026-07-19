import type { OffscreenRequest } from './types';
import type { TranscribeErrorInfo } from '@/lib/transcription/types';
import * as ffmpeg from './ffmpeg-subsystem';
import * as db from './db-subsystem';

ffmpeg.start();
db.start();

chrome.runtime.onMessage.addListener(
  (msg: OffscreenRequest, _sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
    if (msg.type === 'OFFSCREEN_STATUS') {
      sendResponse({ ffmpeg: ffmpeg.getState(), pglite: db.getState() });
      return false;
    }

    if (msg.type === 'OFFSCREEN_CHUNK_RELEASE') {
      ffmpeg.release(msg.sessionId);
      sendResponse({ success: true });
      return false;
    }

    if (msg.type === 'OFFSCREEN_CHUNK_PREPARE') {
      ffmpeg.prepare(msg)
        .then(() => sendResponse({ success: true }))
        .catch((err) =>
          sendResponse({ success: false, error: err as TranscribeErrorInfo }),
        );
      return true;
    }

    if (msg.type === 'OFFSCREEN_CHUNK_TRANSCRIBE') {
      ffmpeg.transcribe(msg)
        .then((rows) => sendResponse({ success: true, rows }))
        .catch((err) =>
          sendResponse({ success: false, error: err as TranscribeErrorInfo }),
        );
      return true;
    }

    return false;
  },
);
