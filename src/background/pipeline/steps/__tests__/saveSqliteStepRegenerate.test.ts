/**
 * saveSqliteStepRegenerate.test.ts — UPDATE-in-place branch (PBI 2026-09-22-04).
 *
 * Pins the binding contract: targetEntryId → mutate({type:'update'}) with the
 * whitelist projection; failures THROW and NEVER enqueue the pending-insert
 * retry (that queue replays INSERTs — a retried insert would duplicate the
 * row the update was replacing). The insert path is untouched (covered by
 * saveSqliteStepDoubleFailure.test.ts).
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
vi.mock('../../../pendingSqliteQueue.js', () => ({
  enqueuePendingRecord: vi.fn().mockResolvedValue(true),
}));

import { saveSqliteStep, RegenerateUpdateError } from '../saveSqliteStep.js';
import { buildRegenerateUpdateFields, REGENERATE_UPDATE_FIELDS } from '../../mappers/regenerateUpdateFields.js';
import { enqueuePendingRecord } from '../../../pendingSqliteQueue.js';
import type { SqliteClient } from '../../../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../../../utils/sqlite-types.js';

function makeClient(mutate: ReturnType<typeof vi.fn>): SqliteClient {
  return { mutate } as unknown as SqliteClient;
}

function makeRecord(): BrowsingLogRecord {
  return {
    url: 'https://example.com/page',
    title: 'T',
    created_at: Date.now(),
    summary: 'fresh summary',
    content: 'fresh content',
    fallback_triggered: 1,
    fallback_reason: 'candidate_too_small',
  };
}

describe('saveSqliteStep — regenerate UPDATE branch (CRITICAL: update-never-insert)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates the target row with the whitelist projection and never enqueues', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const record = makeRecord();

    await saveSqliteStep({
      recordId: 'regen-7',
      record,
      sqliteClient: makeClient(mutate),
      targetEntryId: 7,
      traceId: 'trace-1',
    });

    expect(mutate).toHaveBeenCalledTimes(1);
    const call = mutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(call).toMatchObject({ type: 'update', id: 7, traceId: 'trace-1' });
    expect(Object.keys(call.changes as object).sort()).toEqual([...REGENERATE_UPDATE_FIELDS].sort());
    expect(buildRegenerateUpdateFields(record)).toEqual(call.changes);
    expect(enqueuePendingRecord).not.toHaveBeenCalled();
  });

  it('throws on update failure (success:false) and still never enqueues', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: false, error: { message: 'no such row' } });
    await expect(
      saveSqliteStep({
        recordId: 'regen-7',
        record: makeRecord(),
        sqliteClient: makeClient(mutate),
        targetEntryId: 7,
      }),
    ).rejects.toThrow('SQLite regenerate update failed for id=7');
    expect(enqueuePendingRecord).not.toHaveBeenCalled();
  });

  it('throws when mutate itself rejects (no silent success, no enqueue)', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('db locked'));
    await expect(
      saveSqliteStep({
        recordId: 'regen-7',
        record: makeRecord(),
        sqliteClient: makeClient(mutate),
        targetEntryId: 7,
      }),
    ).rejects.toThrow('db locked');
    expect(enqueuePendingRecord).not.toHaveBeenCalled();
  });

  it('takes the insert path unchanged when targetEntryId is undefined (byte-identical normal record)', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true, data: { id: 9 } });
    await saveSqliteStep({
      recordId: 'r1',
      record: makeRecord(),
      sqliteClient: makeClient(mutate),
    });
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'insert' }));
    expect(mutate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
  });
});

describe('saveSqliteStep — contentEnabled gate (PBI 2026-09-22-04)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('OMITS the content key when content storage is disabled (never nulls pre-existing content)', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true, data: undefined });
    await saveSqliteStep({
      recordId: 'regen-7',
      record: makeRecord(),
      sqliteClient: makeClient(mutate),
      targetEntryId: 7,
      contentEnabled: false,
    });
    const call = mutate.mock.calls[0]![0] as Record<string, unknown>;
    const changes = call.changes as Record<string, unknown>;
    expect('content' in changes).toBe(false);
    // Every other whitelist column is still present.
    expect(Object.keys(changes).sort()).toEqual(
      REGENERATE_UPDATE_FIELDS.filter((f) => f !== 'content').sort(),
    );
  });

  it('includes content when content storage is enabled (or when the flag is absent)', async () => {
    for (const contentEnabled of [true, undefined]) {
      vi.clearAllMocks();
      const mutate = vi.fn().mockResolvedValue({ success: true, data: undefined });
      await saveSqliteStep({
        recordId: 'regen-7',
        record: makeRecord(),
        sqliteClient: makeClient(mutate),
        targetEntryId: 7,
        ...(contentEnabled !== undefined ? { contentEnabled } : {}),
      });
      const call = mutate.mock.calls[0]![0] as Record<string, unknown>;
      const changes = call.changes as Record<string, unknown>;
      expect('content' in changes).toBe(true);
    }
  });

  it('update failure rejects with the typed RegenerateUpdateError', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: false, error: { message: 'disk full' } });
    await expect(
      saveSqliteStep({
        recordId: 'regen-7',
        record: makeRecord(),
        sqliteClient: makeClient(mutate),
        targetEntryId: 7,
      }),
    ).rejects.toBeInstanceOf(RegenerateUpdateError);
  });
});

describe('saveSqliteStep — aiSucceeded write gate (PBI 2026-09-22-04 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the UPDATE when the AI produced no real summary (row left untouched)', async () => {
    const mutate = vi.fn().mockResolvedValue({ success: true, data: undefined });
    await saveSqliteStep({
      recordId: 'regen-7',
      record: makeRecord(),
      sqliteClient: makeClient(mutate),
      targetEntryId: 7,
      aiSucceeded: false,
    });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('proceeds when aiSucceeded is true or absent (legacy)', async () => {
    for (const aiSucceeded of [true, undefined] as const) {
      vi.clearAllMocks();
      const mutate = vi.fn().mockResolvedValue({ success: true, data: undefined });
      await saveSqliteStep({
        recordId: 'regen-7',
        record: makeRecord(),
        sqliteClient: makeClient(mutate),
        targetEntryId: 7,
        ...(aiSucceeded !== undefined ? { aiSucceeded } : {}),
      });
      expect(mutate).toHaveBeenCalledTimes(1);
    }
  });
});
