import * as logger from '../logger.js';
import { FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';

describe('logCritical', () => {
  it('records and raises via injected sink', async () => {
    const sink = new FakeCriticalSink();
    await logger.logCritical('disk full', { x: 1 }, ErrorCode.STORAGE_WRITE_FAILURE, 'test', sink);
    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0].message).toBe('disk full');
  });

  it('works without a sink (uses default no-op in test env)', async () => {
    await logger.logCritical('noop', {}, ErrorCode.UNKNOWN_ERROR, 'test');
    // no throw, default sink is no-op without chrome.notifications
  });
});
