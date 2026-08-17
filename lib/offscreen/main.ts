import * as ffmpeg from './ffmpeg-subsystem';
import * as db from './db-subsystem';
import { dispatchOffscreenMessage } from './dispatcher';

ffmpeg.start();
db.start();

chrome.runtime.onMessage.addListener(
  (msg: unknown, sender, sendResponse) => dispatchOffscreenMessage(
    msg,
    sender,
    sendResponse,
    {
      getFfmpegState: ffmpeg.getState,
      getPgliteState: db.getState,
      prepare: ffmpeg.prepare,
      transcribe: ffmpeg.transcribe,
      release: ffmpeg.release,
    },
  ),
);
