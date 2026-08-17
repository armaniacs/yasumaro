/**
 * offscreenTransport-queue.test.ts
 * M7: OffscreenTransport must serialize concurrent requests to the offscreen
 * document — a message must not be sent until the previous one settled.
 *
 * This replaces the former sqliteClient-queue.test.ts which tested
 * SqliteClient's internal Mutex. Serialization is now the transport's
 * responsibility (PBI-2026-08-17-13).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

import { ChromeOffscreenTransport } from '../offscreenTransport.js';
import { Mutex } from '../../utils/Mutex.js';

vi.mock('../../utils/logger.js', () => ({
  addLog: vi.fn(),
  logError: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

vi.mock('../../utils/errorUtils.js', () => ({
  errorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../../utils/deviceUtils.js', () => ({
  getPlatformOs: vi.fn().mockReturnValue('macos'),
}));

describe('ChromeOffscreenTransport — request queue (M7)', () => {
  let transport: ChromeOffscreenTransport;
  let sendMessageMock: ReturnType<typeof vi.fn>;
  let inFlight: number;
  let maxConcurrent: number;
  let pendingCallbacks: Array<() => void>;

  beforeEach(() => {
    vi.clearAllMocks();
    inFlight = 0;
    maxConcurrent = 0;
    pendingCallbacks = [];

    sendMessageMock = vi.fn((_msg: unknown, callback: (response: unknown) => void) => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      pendingCallbacks.push(() => {
        inFlight--;
        callback({ success: true, rows: [], total: 0 });
      });
    });

    (globalThis as any).chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn().mockResolvedValue(undefined),
        Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
      },
      runtime: {
        sendMessage: sendMessageMock,
        lastError: undefined as { message: string } | undefined,
      },
    };

    transport = new ChromeOffscreenTransport();
  });

  it('does not send a second message until the first has settled', async () => {
    const p1 = transport.msgOffscreen('SQLITE_QUERY', { limit: 1 });
    const p2 = transport.msgOffscreen('SQLITE_QUERY', { limit: 2 });

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
