import { describe, it, expect } from 'vitest';
import { SingleFlight } from '../singleFlight.js';

describe('SingleFlight (PBI 2026-09-12-30)', () => {
  it('join: concurrent same-key callers share one execution and its outcome', async () => {
    const sf = new SingleFlight<string>();
    let executions = 0;
    let release: (v: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => { release = resolve; });

    const first = sf.run('k', async () => { executions++; await gate; }, 'join');
    const second = sf.run('k', async () => { executions++; }, 'join');

    release('done');
    await Promise.all([first, second]);
    expect(executions).toBe(1);
  });

  it('drop: concurrent same-key callers do not execute; post-completion calls run', async () => {
    const sf = new SingleFlight<string>();
    let executions = 0;
    let release: (v: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => { release = resolve; });

    const first = sf.run('k', async () => { executions++; await gate; }, 'drop');
    await sf.run('k', async () => { executions++; }, 'drop');
    expect(executions).toBe(1);

    release('done');
    await first;

    // After completion a new run may start
    await sf.run('k', async () => { executions++; }, 'drop');
    expect(executions).toBe(2);
  });

  it('different keys run in parallel under both policies', async () => {
    const sf = new SingleFlight<string>();
    let a = 0;
    let b = 0;
    let releaseA: (v: unknown) => void = () => undefined;
    const gateA = new Promise((resolve) => { releaseA = resolve; });

    const runA = sf.run('a', async () => { a++; await gateA; }, 'join');
    await sf.run('b', async () => { b++; }, 'join');
    expect(b).toBe(1); // b ran despite a still in flight

    await sf.run('c', async () => { a++; }, 'drop');
    // c ran despite a still in flight — different keys are independent
    expect(a).toBe(2);

    releaseA('done');
    await runA;
    expect(a).toBe(2);
  });

  it('join propagates the in-flight failure without re-running', async () => {
    const sf = new SingleFlight<string>();
    let executions = 0;
    const failing = sf.run('k', async () => {
      executions++;
      throw new Error('boom');
    }, 'join');

    const joined = sf.run('k', async () => { executions++; }, 'join');
    await expect(failing).rejects.toThrow('boom');
    await expect(joined).rejects.toThrow('boom');
    expect(executions).toBe(1);
    // Slot released after failure — next call runs
    await sf.run('k', async () => { executions++; }, 'join');
    expect(executions).toBe(2);
  });

  it('drop swallows the in-flight failure for the dropped caller (initiator still rejects)', async () => {
    const sf = new SingleFlight<string>();
    let executions = 0;
    let release: (v: unknown) => void = () => undefined;
    const gate = new Promise((resolve) => { release = resolve; });

    const failing = sf.run('k', async () => { executions++; await gate; throw new Error('boom'); }, 'drop');
    // Dropped caller resolves without executing and without the failure
    await expect(sf.run('k', async () => { executions++; }, 'drop')).resolves.toBeUndefined();

    release('done');
    // The initiator's own promise still rejects (failure not silenced for it)
    await expect(failing).rejects.toThrow('boom');
    expect(executions).toBe(1);
  });
});
