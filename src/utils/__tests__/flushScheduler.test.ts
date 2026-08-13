import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ImmediateFlushScheduler, ChromeAlarmFlushScheduler } from '../logger/flushScheduler.js';

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

  it('clear does not throw (no-op fake, no real alarm to clear)', () => {
    const scheduler = new ImmediateFlushScheduler();
    expect(() => scheduler.clear()).not.toThrow();
  });
});

describe('ChromeAlarmFlushScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an alarm named yasumaro-logger-flush on schedule', () => {
    const scheduler = new ChromeAlarmFlushScheduler();
    scheduler.schedule();
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      'yasumaro-logger-flush',
      expect.objectContaining({ delayInMinutes: 1 })
    );
  });

  it('clears the same alarm it schedules', () => {
    const scheduler = new ChromeAlarmFlushScheduler();
    scheduler.clear();
    expect(chrome.alarms.clear).toHaveBeenCalledWith('yasumaro-logger-flush');
  });
});
