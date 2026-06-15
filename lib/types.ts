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
