export type SubtitleSource = 'official' | 'asr';

export interface SubtitleRow {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleResult {
  status: 'ok' | 'no_subtitle' | 'error';
  rows: SubtitleRow[];
  source?: SubtitleSource;
  error?: string;
}
