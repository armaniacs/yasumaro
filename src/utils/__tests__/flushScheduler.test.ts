import { ImmediateFlushScheduler } from '../logger/flushScheduler.js';

describe('ImmediateFlushScheduler', () => {
  it('invokes the registered handler immediately on schedule', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; return Promise.resolve(); });
    scheduler.schedule();
    expect(called).toBe(1);
  });

  it('flushNow triggers the handler', async () => {
    const scheduler = new ImmediateFlushScheduler();
    let called = 0;
    scheduler.onFlushRequested(() => { called++; return Promise.resolve(); });
    await scheduler.flushNow();
    expect(called).toBe(1);
  });
});
