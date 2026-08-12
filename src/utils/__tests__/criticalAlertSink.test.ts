import { ChromeNotificationCriticalSink, FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';

describe('FakeCriticalSink', () => {
  it('records raised alerts', () => {
    const sink = new FakeCriticalSink();
    sink.raise('boom', { a: 1 }, ErrorCode.UNKNOWN_ERROR);
    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).toBe('boom');
  });
});

describe('ChromeNotificationCriticalSink cooldown', () => {
  it('suppresses within cooldown window', () => {
    const sink = new ChromeNotificationCriticalSink({ now: () => 0, notifications: undefined });
    const first = sink.shouldRaise();
    const second = sink.shouldRaise();
    expect(first).toBe(true);
    expect(second).toBe(false); // cooldown active
  });
});
