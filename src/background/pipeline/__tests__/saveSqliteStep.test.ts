import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { saveSqliteStep } from '../steps/saveSqliteStep.js';
import type { SqliteClient } from '../../sqlite/offscreenGateway.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

function makeMockSqlite(overrides: Partial<Record<string, any>> = {}): SqliteClient {
  const mutate = (overrides as any).mutate ?? vi.fn().mockImplementation((op: any) => {
    if (op.type === 'insert') return Promise.resolve({ success: true, data: { id: 1 } });
    if (op.type === 'update') return Promise.resolve({ success: true, data: undefined });
    return Promise.resolve({ success: true, data: undefined });
  });

  const mock = {
    mutate,
    ...overrides,
  } as unknown as SqliteClient;

  return mock;
}

describe('saveSqliteStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls mutate insert and mutate update directly (no optimistic lock)', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: true,
    });

    expect(mockSqlite.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'insert' }));
    expect(mockSqlite.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', id: 1 }));
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

  it('skips mutate update when obsidianSynced is undefined', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
    });

    expect(mockSqlite.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'insert' }));
    expect(mockSqlite.mutate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
  });

  it('calls mutate update with obsidian_synced=1 when obsidianSynced is true', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: true,
    });

    expect(mockSqlite.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', id: 1, changes: { obsidian_synced: 1 } }));
  });

  it('calls mutate update with obsidian_synced=0 when obsidianSynced is false', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: false,
    });

    expect(mockSqlite.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'update', id: 1, changes: { obsidian_synced: 0 } }));
  });

  it('throws when mutate insert fails', async () => {
    const mutate = vi.fn().mockImplementation((op: any) => {
      if (op.type === 'insert') return Promise.resolve({ success: false, error: { kind: 'sqlite_error', message: 'mock failure', retriable: false } });
      return Promise.resolve({ success: true, data: undefined });
    });
    const mockSqlite = makeMockSqlite({ mutate } as any);

    await expect(
      saveSqliteStep({
        recordId: 1,
        record: { url: 'https://x.com', created_at: 100 },
        sqliteClient: mockSqlite,
      })
    ).rejects.toThrow('SQLite insert failed');

    expect(mockSqlite.mutate).toHaveBeenCalledWith(expect.objectContaining({ type: 'insert' }));
    expect(mockSqlite.mutate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
  });

  it('does not call mutate update when mutate insert fails', async () => {
    const mutate = vi.fn().mockImplementation((op: any) => {
      if (op.type === 'insert') return Promise.resolve({ success: false, error: { kind: 'sqlite_error', message: 'mock failure', retriable: false } });
      return Promise.resolve({ success: true, data: undefined });
    });
    const mockSqlite = makeMockSqlite({ mutate } as any);

    await expect(
      saveSqliteStep({
        recordId: 1,
        record: { url: 'https://x.com', created_at: 100 },
        sqliteClient: mockSqlite,
        obsidianSynced: true,
      })
    ).rejects.toThrow();

    expect(mockSqlite.mutate).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'update' }));
  });
});

describe('saveSqliteStep — diagnostic metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes full diagnostic metadata to mutate insert', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ success: true, data: { id: 42 } });
    const mutate = vi.fn().mockImplementation((op: any) => {
      if (op.type === 'insert') return mockInsert(op.record, op.traceId);
      if (op.type === 'update') return Promise.resolve({ success: true, data: undefined });
      return Promise.resolve({ success: true, data: undefined });
    });
    const mockClient = {
      mutate,
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
