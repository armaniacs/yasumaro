// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { runSpikeSteps, type SpikeStep } from '../opfsSpike.js';

describe('runSpikeSteps', () => {
  it('runs all steps in order and reports passed when every step succeeds', async () => {
    const order: string[] = [];
    const steps: SpikeStep[] = [
      { name: 'init', run: async () => { order.push('init'); return 'db opened'; } },
      { name: 'insert', run: async () => { order.push('insert'); } },
    ];

    const report = await runSpikeSteps(steps);

    expect(order).toEqual(['init', 'insert']);
    expect(report.passed).toBe(true);
    expect(report.steps).toEqual([
      { name: 'init', ok: true, detail: 'db opened' },
      { name: 'insert', ok: true, detail: '' },
    ]);
  });

  it('stops at the first failing step and reports the error', async () => {
    const order: string[] = [];
    const steps: SpikeStep[] = [
      { name: 'init', run: async () => { order.push('init'); } },
      { name: 'insert', run: async () => { order.push('insert'); throw new Error('boom'); } },
      { name: 'select', run: async () => { order.push('select'); } },
    ];

    const report = await runSpikeSteps(steps);

    expect(order).toEqual(['init', 'insert']); // select never runs
    expect(report.passed).toBe(false);
    expect(report.steps).toEqual([
      { name: 'init', ok: true, detail: '' },
      { name: 'insert', ok: false, detail: 'boom' },
    ]);
  });
});
