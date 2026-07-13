/**
 * sqliteClient-queue.test.ts
 * M7: SqliteClient must serialize concurrent requests to the offscreen
 * document — a message must not be sent until the previous one settled,
 * so the offscreen document (a single-threaded document) doesn't get
 * hit with overlapping requests that race each other.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  ErrorCode: { STORAGE_READ_FAILURE: 'STRG_RD_001' },
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

describe('SqliteClient — request queue (M7)', () => {
  let client: SqliteClient;
  let inFlight: number;
  let maxConcurrent: number;
  let pendingCallbacks: Array<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SqliteClient();
    inFlight = 0;
    maxConcurrent = 0;
    pendingCallbacks = [];

    (globalThis as any).chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
      },
      runtime: {
        sendMessage: vi.fn((_msg: unknown, callback: (response: unknown) => void) => {
          inFlight++;
          maxConcurrent = Math.max(maxConcurrent, inFlight);
          // Defer resolution so overlapping calls would show up as inFlight > 1
          pendingCallbacks.push(() => {
            inFlight--;
            callback({ success: true, rows: [], total: 0 });
          });
        }),
        lastError: undefined as { message: string } | undefined,
      },
    };
  });

  it('does not send a second message until the first has settled', async () => {
    const p1 = client.query({ limit: 1 });
    const p2 = client.query({ limit: 2 });

    // Only the first request should have reached sendMessage so far
    await vi.waitFor(() => expect(pendingCallbacks.length).toBe(1));

    // Settle the first — this should let the second proceed
    pendingCallbacks[0]();
    await vi.waitFor(() => expect(pendingCallbacks.length).toBe(2));

    pendingCallbacks[1]();
    await p1;
    await p2;

    expect(maxConcurrent).toBe(1);
  });
});
