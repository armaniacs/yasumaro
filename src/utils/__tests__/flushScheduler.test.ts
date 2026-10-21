import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitForMock } from '../../../testDir/waitPolicy.js';
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

  // ── PBI 03: a rejected flush must not surface as an unhandled rejection ──
  it('reports a rejected scheduled flush through console.error', async () => {
    const scheduler = new ChromeAlarmFlushScheduler();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    scheduler.onFlushRequested(() => Promise.reject(new Error('flush exploded')));

    const alarmListener = (chrome.alarms.onAlarm.addListener as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0] as
      | ((alarm: chrome.alarms.Alarm) => void)
      | undefined;
    expect(alarmListener).toBeDefined();

    alarmListener!({ name: 'yasumaro-logger-flush' } as chrome.alarms.Alarm);

    // The catch runs on a microtask turn after the fire-and-forget call
    await waitForMock(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith('[Logger] Scheduled flush failed', expect.any(Error));
    });
  });

  it('reports a failed suspend flush through console.error instead of rejecting', async () => {
    // The default chrome global carries no onSuspend; the scheduler skips its
    // registration without one.
    const suspendAddListener = vi.fn();
    (chrome.runtime as unknown as Record<string, unknown>).onSuspend = { addListener: suspendAddListener };

    const scheduler = new ChromeAlarmFlushScheduler();
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    scheduler.onFlushRequested(() => Promise.reject(new Error('flush exploded')));

    const suspendListener = suspendAddListener.mock.calls.at(-1)?.[0] as (() => Promise<void>) | undefined;
    expect(suspendListener).toBeDefined();

    // The listener is async: awaiting it waits for the whole race/catch body
    await suspendListener!();

    expect(consoleErrorSpy).toHaveBeenCalledWith('[Logger] Flush during suspend failed', expect.any(Error));
  });
});
