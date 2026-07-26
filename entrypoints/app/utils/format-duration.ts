/**
 * Duration badges (bilibili / youtube cards) — domain-named alias over the
 * shared clock formatter. The implementation lives in `lib/format.ts` so the
 * content-script panel and the summary prompt builder render the exact same
 * `m:ss` / `h:mm:ss` strings from one function.
 */
export { formatClock as formatDuration } from '@/lib/format';
