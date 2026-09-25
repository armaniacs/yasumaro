import { describe, expect, it } from 'vitest';
import { BaseOffscreenTransport } from '../OffscreenTransportBase.js';
import type { OffscreenResponse, SqliteMessageType } from '../../messaging/sqliteMessages.js';

class FailingTransport extends BaseOffscreenTransport {
  attempts = 0;

  protected async sendOnce(
    _type: SqliteMessageType,
    _payload: Record<string, unknown>,
    _traceId: string,
  ): Promise<OffscreenResponse> {
    this.attempts += 1;
    throw new Error('transport failure');
  }

  protected invalidateContainer(): void {}
}

class ResponseLossTransport extends BaseOffscreenTransport {
  attempts = 0;
  sideEffects = 0;

  protected async sendOnce(
    _type: SqliteMessageType,
    _payload: Record<string, unknown>,
    _traceId: string,
  ): Promise<OffscreenResponse> {
    this.attempts += 1;
    this.sideEffects += 1;
    if (this.attempts === 1) {
      throw new Error('response lost after commit');
    }
    return { success: true };
  }

  protected invalidateContainer(): void {}
}

async function expectFailure(transport: FailingTransport, type: SqliteMessageType, expectedAttempts: number): Promise<void> {
  await expect(transport.msgOffscreen(type, {})).rejects.toThrow('transport failure');
  expect(transport.attempts).toBe(expectedAttempts);
}

describe('BaseOffscreenTransport retry policy', () => {
  it('retries retry-safe operations at most once', async () => {
    expect.hasAssertions();
    for (const type of [
      'SQLITE_UPDATE',
      'SQLITE_DELETE',
      'SQLITE_QUERY',
      'SQLITE_AUDIT_LOG_QUERY',
      'SQLITE_COUNT',
      'SQLITE_STATUS',
      'SQLITE_INIT',
      'SQLITE_BACKUP',
      'SQLITE_CLEAR_ALL',
      'SQLITE_HEALTH_CHECK',
      'SQLITE_ARCHIVE_PREVIEW',
      'SQLITE_ARCHIVE_CLEANUP',
      'SQLITE_ARCHIVE_EXPORT',
      'SQLITE_ARCHIVE_RESTORE_PREVIEW',
      'SQLITE_ARCHIVE_QUERY',
      'SQLITE_ARCHIVE_UPDATE',
      'SQLITE_ARCHIVE_STATUS',
    ] satisfies SqliteMessageType[]) {
      await expectFailure(new FailingTransport(), type, 2);
    }
  });

  it('does not retry retry-unsafe or unconfigured operations', async () => {
    expect.hasAssertions();
    for (const type of [
      'SQLITE_INSERT',
      'SQLITE_INSERT_BATCH',
      'SQLITE_AUDIT_LOG_INSERT',
      'SQLITE_TOGGLE_STAR',
      'SQLITE_RESTORE',
      'SQLITE_PURGE',
      'CONTENT_PURGE',
      'SQLITE_ARCHIVE_PREPARE_INCOMING',
      'SQLITE_ARCHIVE_CREATE',
      'SQLITE_ARCHIVE_RESTORE',
      'SQLITE_ARCHIVE_DELETE_BY_STAGING',
      'SQLITE_ARCHIVE_OPEN',
      'SQLITE_ARCHIVE_SAVE',
      'SQLITE_ARCHIVE_CLOSE',
      'SQLITE_FUTURE_OPERATION' as SqliteMessageType,
    ] satisfies SqliteMessageType[]) {
      await expectFailure(new FailingTransport(), type, 1);
    }
  });

  it('does not resend retry-unsafe inserts after a response-loss failure', async () => {
    for (const type of ['SQLITE_INSERT', 'SQLITE_INSERT_BATCH'] as const) {
      const transport = new ResponseLossTransport();

      await expect(transport.msgOffscreen(type, {})).rejects.toThrow('response lost after commit');

      expect(transport.attempts).toBe(1);
      expect(transport.sideEffects).toBe(1);
    }
  });

  it('retries a retry-safe operation once after a response-loss failure', async () => {
    const transport = new ResponseLossTransport();

    await expect(transport.msgOffscreen('SQLITE_UPDATE', {})).resolves.toEqual({ success: true });

    expect(transport.attempts).toBe(2);
    expect(transport.sideEffects).toBe(2);
  });

  it('does not resend an unconfigured operation after a response-loss failure', async () => {
    const transport = new ResponseLossTransport();

    await expect(transport.msgOffscreen('SQLITE_FUTURE_OPERATION' as SqliteMessageType, {})).rejects.toThrow(
      'response lost after commit',
    );

    expect(transport.attempts).toBe(1);
    expect(transport.sideEffects).toBe(1);
  });

  it('keeps archive and toggleStar operations at one send after a response-loss failure', async () => {
    for (const type of [
      'SQLITE_TOGGLE_STAR',
      'SQLITE_ARCHIVE_CREATE',
      'SQLITE_ARCHIVE_RESTORE',
      'SQLITE_ARCHIVE_DELETE_BY_STAGING',
      'SQLITE_ARCHIVE_OPEN',
      'SQLITE_ARCHIVE_SAVE',
      'SQLITE_ARCHIVE_CLOSE',
      'SQLITE_ARCHIVE_PREPARE_INCOMING',
    ] as const) {
      const transport = new ResponseLossTransport();

      await expect(transport.msgOffscreen(type, {})).rejects.toThrow('response lost after commit');

      expect(transport.attempts).toBe(1);
      expect(transport.sideEffects).toBe(1);
    }
  });

  it('keeps the explicit noRetry contract for a retry-safe message', async () => {
    const transport = new FailingTransport();
    await expect(transport.msgOffscreen('SQLITE_QUERY', {}, '', { noRetry: true })).rejects.toThrow('transport failure');
    expect(transport.attempts).toBe(1);
  });
});
