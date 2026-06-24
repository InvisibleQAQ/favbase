export interface RawSubtitleItem {
  from: number;
  to: number;
  content: string;
}

/** Auth credentials extracted from bilibili cookies. */
export interface BiliAuthInfo {
  sessdata: string;
  mid: string;
}

/** Bilibili favorite folder metadata. */
export interface BiliFavFolder {
  id: number;
  fid: number;
  mid: number;
  title: string;
  media_count: number;
  cover: string;
  intro: string;
  ctime: number;
  mtime: number;
  attr: number;
  fav_state: number;
}

/** Bilibili subtitle track from player API. */
export interface SubtitleTrack {
  lan: string;
  lan_doc: string;
  subtitle_url: string;
}

/** DASH audio stream descriptor from playurl API. */
export interface DashAudioStream {
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
  backupUrl?: string[];
  backup_url?: string[];
}
