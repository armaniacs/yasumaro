/**
 * sqliteClient-keepalive.test.ts
 * M12: when the offscreen document has gone idle (e.g. on mobile Chrome,
 * where offscreen documents can be suspended), the first message may fail
 * with a connection error. SqliteClient should recreate the document and
 * retry once automatically instead of surfacing a transient failure to
 * the caller.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../sqliteAlert.js', () => ({
  recordSqliteSuccess: vi.fn(),
  recordSqliteFailure: vi.fn(),
}));

import { SqliteClient } from '../sqliteClient.js';

describe('SqliteClient — keepAlive / reconnect (M12)', () => {
  let client: SqliteClient;
  let sendMessageCallCount: number;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SqliteClient();
    sendMessageCallCount = 0;
  });

  function setupFlakyChromeMock() {
    (globalThis as any).chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
      },
      runtime: {
        sendMessage: vi.fn((_msg: unknown, callback: (response: unknown) => void) => {
          sendMessageCallCount++;
          if (sendMessageCallCount === 1) {
            // First attempt: offscreen document was suspended
            (globalThis as any).chrome.runtime.lastError = {
              message: 'Could not establish connection. Receiving end does not exist.',
            };
            callback(undefined);
            return;
          }
          // Retry succeeds
          (globalThis as any).chrome.runtime.lastError = undefined;
          callback({ success: true, rows: [], total: 0 });
        }),
        lastError: undefined as { message: string } | undefined,
      },
    };
  }

  it('retries once and succeeds after a connection error', async () => {
    setupFlakyChromeMock();

    const result = await client.query({ limit: 1 });

    expect(result).toEqual({ rows: [], total: 0 });
    expect(sendMessageCallCount).toBe(2);
  });

  it('gives up and returns null after the retry also fails', async () => {
    (globalThis as any).chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
      },
      runtime: {
        sendMessage: vi.fn((_msg: unknown, callback: (response: unknown) => void) => {
          sendMessageCallCount++;
          (globalThis as any).chrome.runtime.lastError = { message: 'Connection lost' };
          callback(undefined);
        }),
        lastError: undefined as { message: string } | undefined,
      },
    };

    const result = await client.query({ limit: 1 });

    expect(result).toBeNull();
    expect(sendMessageCallCount).toBe(2);
  });
});
