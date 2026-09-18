/**
 * saveSqliteStepDoubleFailure.test.ts
 * Pins the double-failure contract (Code-Quality finding on 0917a, mirroring
 * saveMetadataStep): when the SQLite insert fails AND the fallback queue
 * cannot persist, an ERROR is logged — and the original insert error is
 * still thrown, never masked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../utils/logger/types.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));
vi.mock('../../../../utils/logger/core.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));
vi.mock('../../../../utils/logger/api.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { addLog } from '../../../../utils/logger/core.js';
import { saveSqliteStep } from '../saveSqliteStep.js';
import { enqueuePendingRecord } from '../../../pendingSqliteQueue.js';
import type { BrowsingLogRecord } from '../../../../utils/sqlite-types.js';

function errorMessages(): string[] {
  return (addLog as ReturnType<typeof vi.fn>).mock.calls
    .filter(([type]) => type === 'ERROR')
    .map(([, message]) => String(message));
}

function makeRecord(): BrowsingLogRecord {
  return { url: 'https://example.com/page', title: 'Test', created_at: Date.now() };
}

describe('saveSqliteStep double failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => {}),
        },
      },
    });
  });

  it('enqueuePendingRecord reports false when chrome.storage rejects', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(enqueuePendingRecord(makeRecord())).resolves.toBe(false);
  });

  it('enqueuePendingRecord reports true when persistence succeeds', async () => {
    await expect(enqueuePendingRecord(makeRecord())).resolves.toBe(true);
  });

  it('logs ERROR for the queue failure and still throws the insert error', async () => {
    (chrome.storage.local.set as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('quota exceeded'));
    const sqliteClient = {
      mutate: vi.fn().mockResolvedValue({ success: false, error: { kind: 'unavailable', message: 'down', retriable: true } }),
    };

    await expect(
      saveSqliteStep({ recordId: 'r1', record: makeRecord(), sqliteClient: sqliteClient as never }),
    ).rejects.toThrow('SQLite insert failed');

    expect(errorMessages().some((m) => m.includes('failed to queue record for retry'))).toBe(true);
  });

  it('logs no queue ERROR when the fallback persists', async () => {
    const sqliteClient = {
      mutate: vi.fn().mockResolvedValue({ success: false, error: { kind: 'unavailable', message: 'down', retriable: true } }),
    };

    await expect(
      saveSqliteStep({ recordId: 'r1', record: makeRecord(), sqliteClient: sqliteClient as never }),
    ).rejects.toThrow('SQLite insert failed');

    expect(errorMessages().some((m) => m.includes('failed to queue record for retry'))).toBe(false);
  });
});
