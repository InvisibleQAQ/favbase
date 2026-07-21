/** MV3 local favicon endpoint. Resolution stays on-device. */
export function bookmarkFaviconUrl(pageUrl: string): string {
  try {
    const url = new URL(chrome.runtime.getURL('/_favicon/'));
    url.searchParams.set('pageUrl', pageUrl);
    url.searchParams.set('size', '32');
    return url.toString();
  } catch {
    return '';
  }
}

export function bookmarkDisplayName(title: string, pageUrl: string): string {
  const trimmedTitle = title.trim();
  if (trimmedTitle) return trimmedTitle;
  try {
    return new URL(pageUrl).hostname || pageUrl;
  } catch {
    return pageUrl;
  }
}
