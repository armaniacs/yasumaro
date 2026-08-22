import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { saveSqliteStep } from '../steps/saveSqliteStep.js';
import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

function makeMockSqlite(overrides: Partial<SqliteClient> = {}): SqliteClient {
  const insertResult = vi.fn().mockResolvedValue({ success: true, data: { id: 1 } });
  const updateResult = vi.fn().mockResolvedValue({ success: true, data: undefined });

  const mock = {
    insertResult,
    updateResult,
    mutate: vi.fn().mockImplementation((op: any) => {
      if (op.type === 'insert') return (mock as any).insertResult(op.record, op.traceId);
      if (op.type === 'update') return (mock as any).updateResult(op.id, op.changes, op.traceId);
      return Promise.resolve({ success: true, data: undefined });
    }),
    ...overrides,
  } as unknown as SqliteClient;

  return mock;
}

describe('saveSqliteStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls insertResult and updateResult directly (no optimistic lock)', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: true,
    });

    expect(mockSqlite.insertResult).toHaveBeenCalled();
    expect(mockSqlite.updateResult).toHaveBeenCalled();
  });

  it('does not write to old chrome.storage.savedUrlsWithTimestamps', async () => {
    const setSpy = vi.spyOn(chrome.storage.local, 'set');
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
    });

    const callsToLegacy = setSpy.mock.calls.filter(
      (call) => call[0] && 'savedUrlsWithTimestamps' in (call[0] as object)
    );
    expect(callsToLegacy).toHaveLength(0);

    setSpy.mockRestore();
  });

  it('skips update when obsidianSynced is undefined', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
    });

    expect(mockSqlite.insertResult).toHaveBeenCalled();
    expect(mockSqlite.updateResult).not.toHaveBeenCalled();
  });

  it('calls updateResult with obsidian_synced=1 when obsidianSynced is true', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: true,
    });

    expect(mockSqlite.updateResult).toHaveBeenCalledWith(1, { obsidian_synced: 1 }, undefined);
  });

  it('calls updateResult with obsidian_synced=0 when obsidianSynced is false', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: false,
    });

    expect(mockSqlite.updateResult).toHaveBeenCalledWith(1, { obsidian_synced: 0 }, undefined);
  });

  it('throws when insertResult fails', async () => {
    const mockSqlite = makeMockSqlite({
      insertResult: vi.fn().mockResolvedValue({
        success: false,
        error: { kind: 'sqlite_error', message: 'mock failure', retriable: false },
      }),
    });

    await expect(
      saveSqliteStep({
        recordId: 1,
        record: { url: 'https://x.com', created_at: 100 },
        sqliteClient: mockSqlite,
      })
    ).rejects.toThrow('SQLite insert failed');

    expect(mockSqlite.insertResult).toHaveBeenCalled();
    expect(mockSqlite.updateResult).not.toHaveBeenCalled();
  });

  it('does not call updateResult when insertResult fails', async () => {
    const mockSqlite = makeMockSqlite({
      insertResult: vi.fn().mockResolvedValue({
        success: false,
        error: { kind: 'sqlite_error', message: 'mock failure', retriable: false },
      }),
    });

    await expect(
      saveSqliteStep({
        recordId: 1,
        record: { url: 'https://x.com', created_at: 100 },
        sqliteClient: mockSqlite,
        obsidianSynced: true,
      })
    ).rejects.toThrow();

    expect(mockSqlite.updateResult).not.toHaveBeenCalled();
  });
});

describe('saveSqliteStep — diagnostic metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes full diagnostic metadata to insertResult', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ success: true, data: { id: 42 } });
    const mockUpdate = vi.fn().mockResolvedValue({ success: true, data: undefined });
    const mockClient = {
      insertResult: mockInsert,
      updateResult: mockUpdate,
      mutate: vi.fn().mockImplementation((op: any) => {
        if (op.type === 'insert') return mockInsert(op.record, op.traceId);
        if (op.type === 'update') return mockUpdate(op.id, op.changes, op.traceId);
        return Promise.resolve({ success: true, data: undefined });
      }),
    } as unknown as SqliteClient;

    const record: BrowsingLogRecord = {
      url: 'https://example.com/page',
      title: 'Test Page',
      summary: 'AI summary',
      tags: '#tag1 #tag2',
      created_at: Date.now(),
      domain: 'example.com',
      visit_duration: null,
      scroll_ratio: null,
      is_starred: 0,
      is_deleted: 0,
      content: null,
      masked_count: 3,
      cleansed_reason: 'hard',
      ai_provider: 'openai',
      ai_model: 'gpt-4',
      ai_duration_ms: 5000,
      obsidian_duration_ms: 1200,
      sent_tokens: 100,
      received_tokens: 50,
      original_tokens: 200,
      cleansed_tokens: 150,
      page_bytes: 10000,
      candidate_bytes: 5000,
      original_bytes: 8000,
      cleansed_bytes: 4000,
      ai_summary_original_bytes: 2000,
      ai_summary_cleansed_bytes: 1500,
      extracted_sentences_bytes: 6000,
      extracted_sentences_original_bytes: 10000,
      fallback_triggered: 1,
    };

    await saveSqliteStep({
      recordId: 0,
      record,
      sqliteClient: mockClient,
    });

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const inserted = mockInsert.mock.calls[0][0] as BrowsingLogRecord;
    expect(inserted.masked_count).toBe(3);
    expect(inserted.ai_provider).toBe('openai');
    expect(inserted.ai_duration_ms).toBe(5000);
    expect(inserted.sent_tokens).toBe(100);
    expect(inserted.fallback_triggered).toBe(1);
  });
});
