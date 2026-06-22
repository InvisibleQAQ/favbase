const BILI_COOKIE_URL = 'https://www.bilibili.com';

export interface BiliAuthInfo {
  sessdata: string;
  mid: string;
}

export async function getBiliAuth(): Promise<BiliAuthInfo | null> {
  const [sessdataCookie, midCookie] = await Promise.all([
    chrome.cookies.get({ url: BILI_COOKIE_URL, name: 'SESSDATA' }),
    chrome.cookies.get({ url: BILI_COOKIE_URL, name: 'DedeUserID' }),
  ]);

  if (!sessdataCookie?.value || !midCookie?.value) return null;

  const now = Date.now() / 1000;
  if (sessdataCookie.expirationDate && sessdataCookie.expirationDate < now) {
    return null;
  }

  return {
    sessdata: sessdataCookie.value,
    mid: midCookie.value,
  };
}
