import { useEffect } from 'react';

const APP_URL = browser.runtime.getURL('/app.html');

async function openOrFocusApp() {
  const tabs = await browser.tabs.query({ url: APP_URL });
  if (tabs.length > 0 && tabs[0].id != null) {
    await browser.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId != null) {
      await browser.windows.update(tabs[0].windowId, { focused: true });
    }
  } else {
    await browser.tabs.create({ url: APP_URL });
  }
  window.close();
}

export default function App() {
  useEffect(() => {
    openOrFocusApp();
  }, []);

  return null;
}
