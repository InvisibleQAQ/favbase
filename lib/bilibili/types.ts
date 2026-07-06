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

/** Video item inside a bilibili favorite folder (from /x/v3/fav/resource/list). */
export interface BiliFavVideo {
  id: number;
  type: number;
  title: string;
  cover: string;
  intro: string;
  duration: number;
  bvid: string;
  upper: { mid: number; name: string; face: string };
  cnt_info: { play: number; collect: number; danmaku: number };
  fav_time: number;
  attr: number;
}

/**
 * Sort order for the favorite folder video list (`order` param of
 * `/x/v3/fav/resource/list`). All server-side, descending, full-folder.
 * `mtime` = 收藏时间, `view` = 播放量, `pubtime` = 投稿时间.
 */
export type BiliFavOrder = 'mtime' | 'view' | 'pubtime';

/** Paginated response for favorite folder video list. */
export interface BiliFavVideoListResponse {
  has_more: boolean;
  medias: BiliFavVideo[] | null;
  info: { id: number; title: string; media_count: number };
}

/** DASH audio stream descriptor from playurl API. */
export interface DashAudioStream {
  baseUrl?: string;
  base_url?: string;
  bandwidth?: number;
  backupUrl?: string[];
  backup_url?: string[];
}
