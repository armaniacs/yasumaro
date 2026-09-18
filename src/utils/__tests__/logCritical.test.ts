import { logCritical } from '../logger/api.js';
import { FakeCriticalSink } from '../logger/criticalAlertSink.js';
import { ErrorCode } from '../logger/types.js';

describe('logCritical', () => {
  it('records and raises via injected sink', async () => {
    const sink = new FakeCriticalSink();
    await logCritical('disk full', { x: 1 }, ErrorCode.STORAGE_WRITE_FAILURE, 'test', sink);
    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0]!.message).toBe('disk full');
  });

  it('works without a sink (uses default no-op in test env)', async () => {
    await expect(
      logCritical('noop', {}, ErrorCode.UNKNOWN_ERROR, 'test')
    ).resolves.not.toThrow();
  });

  it('sanitizes API-key-like content in the message before raising it to the sink', async () => {
    const sink = new FakeCriticalSink();
    // メールアドレスはこのプロジェクトのPIIパターン（piiSanitizer.ts）で
    // 確実に検出・マスキングされる代表的なパターンなので、これを使う。
    const messageWithPii = 'Failed to sync for user test@example.com';
    await logCritical(messageWithPii, {}, ErrorCode.UNKNOWN_ERROR, 'test', sink);

    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0]!.message).not.toBe(messageWithPii);
    expect(sink.raised[0]!.message).not.toContain('test@example.com');
  });

  it('leaves messages without sensitive content unchanged when raising to the sink', async () => {
    const sink = new FakeCriticalSink();
    const plainMessage = 'SQLite sync failed';
    await logCritical(plainMessage, {}, ErrorCode.UNKNOWN_ERROR, 'test', sink);

    expect(sink.raised).toHaveLength(1);
    expect(sink.raised[0]!.message).toBe(plainMessage);
  });
});
