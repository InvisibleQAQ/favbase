import type { InjectState } from './state';

const STEALTH_STYLE_ID = '__favbase_stealth_css__';

export function applyStealthMask(): void {
  if (document.getElementById(STEALTH_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STEALTH_STYLE_ID;
  style.textContent =
    '.bpx-player-video-subtitle { visibility: hidden !important; }' +
    '.bpx-common-toast { display: none !important; }';
  document.head.appendChild(style);
}

export function removeStealthMask(): void {
  document.getElementById(STEALTH_STYLE_ID)?.remove();
}

export function hackSubtitleOff(): void {
  const stateNodes = document.querySelectorAll(
    '.bpx-player-ctrl-subtitle, .bpx-player-ctrl-subtitle-panel, .bilibili-player-video-btn-subtitle',
  );
  stateNodes.forEach((node) => {
    node.classList.remove(
      'active', 'on', 'show', 'open', 'opened',
      'is-active', 'bpx-state-active', 'bpx-state-show', 'bpx-state-opened',
    );
  });

  const containers = document.querySelectorAll(
    '.bpx-player-video-subtitle, .bili-subtitle, .bpx-player-subtitle-wrap, .bpx-player-subtitle',
  );
  containers.forEach((el) => {
    (el as HTMLElement).style.cssText = 'display: none !important; opacity: 0 !important;';
  });
}

export function scheduleVisualRestore(s: InjectState, delayMs: number): void {
  if (s.stealthRestoreTimer) clearTimeout(s.stealthRestoreTimer);
  s.stealthRestoreTimer = setTimeout(() => {
    removeStealthMask();
    s.stealthRestoreTimer = null;
  }, delayMs);
}

export function stopAutoTriggerFlow(s: InjectState): void {
  if (s.autoTriggerTimer) {
    clearTimeout(s.autoTriggerTimer);
    s.autoTriggerTimer = null;
  }
}

function blindSilentOpen(s: InjectState): boolean {
  if (s.isSubtitleCaptured) return false;
  applyStealthMask();

  const allTextDivs = Array.from(
    document.querySelectorAll(
      '.bpx-player-ctrl-subtitle-language-item-text',
    ),
  );
  const chineseTrack = allTextDivs.find((el) =>
    String((el as HTMLElement).innerText || '')
      .trim()
      .includes('中文'),
  );
  if (chineseTrack) {
    (chineseTrack as HTMLElement).click();
    return true;
  }

  const ccBtn = document.querySelector(
    '.bpx-player-ctrl-subtitle',
  ) as HTMLElement | null;
  let clicked = false;
  if (ccBtn) {
    try {
      ccBtn.dispatchEvent(
        new MouseEvent('mouseenter', {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    } catch { /* ignore */ }
    ccBtn.click();
    clicked = true;
  }

  setTimeout(() => {
    if (s.isSubtitleCaptured) return;
    const retryTrack = Array.from(
      document.querySelectorAll(
        '.bpx-player-ctrl-subtitle-language-item-text',
      ),
    ).find((el) =>
      String((el as HTMLElement).innerText || '')
        .trim()
        .includes('中文'),
    );
    if (retryTrack) (retryTrack as HTMLElement).click();
  }, 100);

  return clicked;
}

function autoTriggerLoop(s: InjectState): void {
  if (s.isSubtitleCaptured) return;

  const toggle = document.querySelector(
    '.bpx-player-ctrl-subtitle, .bilibili-player-video-btn-subtitle',
  );
  if (!toggle) {
    s.autoTriggerAttempts += 1;
    if (s.autoTriggerAttempts >= 10) return;
    s.autoTriggerTimer = setTimeout(() => autoTriggerLoop(s), 1000);
    return;
  }

  s.autoTriggerStarted = true;
  blindSilentOpen(s);
}

export function scheduleAutoTriggerFlow(s: InjectState): void {
  if (s.isSubtitleCaptured) return;
  stopAutoTriggerFlow(s);
  s.autoTriggerStarted = false;
  s.autoTriggerAttempts = 0;
  s.autoTriggerTimer = setTimeout(() => autoTriggerLoop(s), 2000);
}
