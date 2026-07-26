/**
 * Host-page video player access, shared by every panel view that offers a
 * jumpable time (subtitle rows, summary chapters). Timestamp *formatting* is
 * not here — it is context-free and lives in `lib/format.ts`.
 */

export function seekVideo(seconds: number): void {
  const video = document.querySelector('video');
  if (!video) return;
  video.currentTime = seconds;
  video.play().catch(() => {});
}
