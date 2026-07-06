import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SqliteClient } from '../sqliteClient.js';

describe('SqliteClient audit log methods', () => {
  let client: SqliteClient;

  beforeEach(() => {
    client = new SqliteClient();
    global.chrome = {
      offscreen: {
        hasDocument: vi.fn().mockResolvedValue(true),
        createDocument: vi.fn(),
        Reason: { WORKERS: 'WORKERS', LOCAL_STORAGE: 'LOCAL_STORAGE' },
      },
      runtime: {
        id: 'test-extension-id',
        sendMessage: vi.fn((msg, callback) => {
          if (msg.type === 'SQLITE_AUDIT_LOG_INSERT') {
            callback({ success: true, id: 42 });
          } else if (msg.type === 'SQLITE_AUDIT_LOG_QUERY') {
            callback({ success: true, rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1000 }], total: 1 });
          }
        }),
        lastError: undefined,
      },
    } as unknown as typeof chrome;
  });

  it('insertAuditLog sends SQLITE_AUDIT_LOG_INSERT and returns id', async () => {
    const result = await client.insertAuditLog({ provider: 'gemini', url: 'https://example.com', created_at: 1000 });
    expect(result).toEqual({ id: 42 });
  });

  it('queryAuditLog sends SQLITE_AUDIT_LOG_QUERY and returns rows', async () => {
    const result = await client.queryAuditLog({ limit: 10, offset: 0 });
    expect(result?.rows).toHaveLength(1);
    expect(result?.total).toBe(1);
  });
});
