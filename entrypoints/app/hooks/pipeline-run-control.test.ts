import { describe, expect, it } from 'vitest';

import { createPipelineRunControl, type PipelineRunPhase } from './pipeline-run-control';

describe('Pipeline Run control', () => {
  it('pauses at the next safe checkpoint and resumes the same run', async () => {
    const phases: PipelineRunPhase[] = [];
    const control = createPipelineRunControl((phase) => phases.push(phase));

    control.pause();
    expect(control.getPhase()).toBe('pausing');

    let continued = false;
    const checkpoint = control.checkpoint().then(() => {
      continued = true;
    });
    await Promise.resolve();

    expect(control.getPhase()).toBe('paused');
    expect(continued).toBe(false);

    control.resume();
    await checkpoint;

    expect(control.getPhase()).toBe('running');
    expect(continued).toBe(true);
    expect(phases).toEqual(['pausing', 'paused', 'running']);
  });

  it('cancels a pending pause when resumed before the next checkpoint', async () => {
    const phases: PipelineRunPhase[] = [];
    const control = createPipelineRunControl((phase) => phases.push(phase));

    control.pause();
    control.pause();
    control.resume();
    control.resume();
    expect(control.getPhase()).toBe('running');

    await control.checkpoint();
    expect(control.getPhase()).toBe('running');
    expect(phases).toEqual(['pausing', 'running']);
  });

  it('blocks a born-paused run at its FIRST checkpoint (library gate)', async () => {
    const phases: PipelineRunPhase[] = [];
    const control = createPipelineRunControl((phase) => phases.push(phase), 'paused');

    expect(control.getPhase()).toBe('paused');

    let continued = false;
    const checkpoint = control.checkpoint().then(() => {
      continued = true;
    });
    await Promise.resolve();

    // No work escaped before the first checkpoint, and no phase was re-emitted.
    expect(continued).toBe(false);
    expect(phases).toEqual([]);

    control.resume();
    await checkpoint;

    expect(control.getPhase()).toBe('running');
    expect(continued).toBe(true);
    expect(phases).toEqual(['running']);
  });

  it('lets a born-paused run through when resumed before its first checkpoint', async () => {
    const control = createPipelineRunControl(() => {}, 'paused');

    control.resume();
    expect(control.getPhase()).toBe('running');

    // No second worker, no dangling resolver: the checkpoint just falls through.
    await control.checkpoint();
    expect(control.getPhase()).toBe('running');
  });

  it('ignores pause on a born-paused run (no phase churn)', () => {
    const phases: PipelineRunPhase[] = [];
    const control = createPipelineRunControl((phase) => phases.push(phase), 'paused');

    control.pause();

    expect(control.getPhase()).toBe('paused');
    expect(phases).toEqual([]);
  });
});
