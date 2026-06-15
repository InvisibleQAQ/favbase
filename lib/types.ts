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

/** PostMessage payload: main world inject script announces bvid + cid. */
export interface SubtitleHandshakeMessage {
  type: 'BILI_SUBTITLE_HANDSHAKE';
  bvid: string;
  cid: number;
}

/** PostMessage payload: main world inject script sends intercepted subtitle data. */
export interface SubtitleDataMessage {
  type: 'BILI_SUBTITLE_DATA';
  data: RawSubtitleItem[];
  bvid: string;
  cid: number;
}

/** PostMessage payload: inject script notifies content script of SPA route change. */
export interface SubtitleRouteSwitchMessage {
  type: 'BILI_ROUTE_SWITCH';
  bvid: string;
}

/** Video metadata returned by /x/web-interface/view. */
export interface VideoPage {
  cid: number;
  page: number;
  part: string;
}

export interface VideoInfo {
  bvid: string;
  title: string;
  pages: VideoPage[];
}
