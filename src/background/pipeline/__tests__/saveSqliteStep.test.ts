import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../../utils/logger.js', () => ({
  addLog: vi.fn(),
  LogType: { INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR', DEBUG: 'DEBUG' },
}));

import { saveSqliteStep } from '../steps/saveSqliteStep.js';
import type { SqliteClient } from '../../sqliteClient.js';
import type { BrowsingLogRecord } from '../../../utils/sqlite-types.js';

function makeMockSqlite(overrides: Partial<SqliteClient> = {}): SqliteClient {
  return {
    insert: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as SqliteClient;
}

describe('saveSqliteStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls insert and update directly (no optimistic lock)', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: true,
    });

    expect(mockSqlite.insert).toHaveBeenCalled();
    expect(mockSqlite.update).toHaveBeenCalled();
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

    expect(mockSqlite.insert).toHaveBeenCalled();
    expect(mockSqlite.update).not.toHaveBeenCalled();
  });

  it('calls update with obsidian_synced=1 when obsidianSynced is true', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: true,
    });

    expect(mockSqlite.update).toHaveBeenCalledWith(1, { obsidian_synced: 1 });
  });

  it('calls update with obsidian_synced=0 when obsidianSynced is false', async () => {
    const mockSqlite = makeMockSqlite();

    await saveSqliteStep({
      recordId: 1,
      record: { url: 'https://x.com', created_at: 100 },
      sqliteClient: mockSqlite,
      obsidianSynced: false,
    });

    expect(mockSqlite.update).toHaveBeenCalledWith(1, { obsidian_synced: 0 });
  });

  it('throws when insert returns null', async () => {
    const mockSqlite = makeMockSqlite({
      insert: vi.fn().mockResolvedValue(null),
    });

    await expect(
      saveSqliteStep({
        recordId: 1,
        record: { url: 'https://x.com', created_at: 100 },
        sqliteClient: mockSqlite,
      })
    ).rejects.toThrow('SQLite insert returned null');

    expect(mockSqlite.insert).toHaveBeenCalled();
    expect(mockSqlite.update).not.toHaveBeenCalled();
  });

  it('does not call update when insert returns null', async () => {
    const mockSqlite = makeMockSqlite({
      insert: vi.fn().mockResolvedValue(null),
    });

    await expect(
      saveSqliteStep({
        recordId: 1,
        record: { url: 'https://x.com', created_at: 100 },
        sqliteClient: mockSqlite,
        obsidianSynced: true,
      })
    ).rejects.toThrow();

    expect(mockSqlite.update).not.toHaveBeenCalled();
  });
});

describe('saveSqliteStep — diagnostic metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes full diagnostic metadata to insert', async () => {
    const mockInsert = vi.fn().mockResolvedValue({ id: 42 });
    const mockUpdate = vi.fn().mockResolvedValue(undefined);
    const mockClient = { insert: mockInsert, update: mockUpdate } as unknown as SqliteClient;

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
