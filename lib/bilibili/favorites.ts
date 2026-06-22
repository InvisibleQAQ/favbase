import { BILIBILI_API } from './api';
import type { BiliAuthInfo } from './auth';

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

interface BiliFavFolderListResponse {
  code: number;
  message: string;
  data: {
    count: number;
    list: BiliFavFolder[];
  } | null;
}

export async function fetchFavFolderList(
  auth: BiliAuthInfo,
): Promise<BiliFavFolder[]> {
  const url = BILIBILI_API.favFolderListAll(auth.mid);
  const res = await fetch(url, {
    headers: { Cookie: `SESSDATA=${auth.sessdata}` },
  });

  if (!res.ok) {
    throw new Error(`Bilibili API HTTP ${res.status}`);
  }

  const json: BiliFavFolderListResponse = await res.json();

  if (json.code === -101) {
    throw new BiliAuthError('SESSDATA expired or invalid');
  }

  if (json.code !== 0) {
    throw new Error(`Bilibili API error ${json.code}: ${json.message}`);
  }

  return json.data?.list ?? [];
}

export class BiliAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BiliAuthError';
  }
}
