import { describe, expect, it } from 'vitest';

import {
  beginExtractionRun,
  deriveExtractionPhase,
  finishExtractionRun,
  getExtractionControlSnapshot,
  recordExtractionProgress,
  requestExtractionPause,
  type ExtractionControlSnapshot,
} from './bookmark-extraction-control';

function control(
  pauseRequested: boolean,
  pauseYielded: boolean,
): ExtractionControlSnapshot {
  return { pauseRequested, pauseYielded, lastProgress: null };
}

describe('deriveExtractionPhase', () => {
  it('distinguishes running, pausing, paused, and a normally completed run', () => {
    expect(deriveExtractionPhase(true, control(false, false))).toBe('running');
    expect(deriveExtractionPhase(true, control(true, false))).toBe('pausing');
    expect(deriveExtractionPhase(false, control(true, true))).toBe('paused');
    expect(deriveExtractionPhase(false, control(true, false))).toBe('idle');
  });

  it('yields only when a pause leaves unprocessed targets', () => {
    const signal = beginExtractionRun();
    recordExtractionProgress({ done: 1, total: 3 });
    requestExtractionPause();
    expect(signal.aborted).toBe(true);
    finishExtractionRun();
    expect(getExtractionControlSnapshot().pauseYielded).toBe(true);

    beginExtractionRun();
    recordExtractionProgress({ done: 3, total: 3 });
    requestExtractionPause();
    finishExtractionRun();
    expect(getExtractionControlSnapshot().pauseYielded).toBe(false);
  });
});
