import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInsertAuditLog = vi.fn().mockResolvedValue({ success: true, data: { id: 1 } });
const mockQueryAuditLogResult = vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });

vi.mock('../../background/sqliteClient.js', () => {
  class MockSqliteClient {
    async insertAuditLogResult(record: Record<string, unknown>) {
      return mockInsertAuditLog(record);
    }

    async queryAuditLogResult(options: Record<string, unknown>) {
      return mockQueryAuditLogResult(options);
    }
  }

  return {
    SqliteClient: MockSqliteClient,
    getSharedSqliteClient: () => new MockSqliteClient(),
  };
});

vi.mock('../logger.js', () => ({
  logError: vi.fn(),
}));

// Import after mocking
import { recordAuditLog, getAuditLogs } from '../auditLog.js';

describe('auditLog', () => {
  beforeEach(() => {
    mockInsertAuditLog.mockClear();
    mockQueryAuditLogResult.mockClear();
    mockInsertAuditLog.mockResolvedValue({ success: true, data: { id: 1 } });
    mockQueryAuditLogResult.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
  });

  it('recordAuditLog calls SqliteClient.insertAuditLogResult with provider, url, and a timestamp', async () => {
    await recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' });

    expect(mockInsertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gemini', url: 'https://example.com/page' })
    );
    const callArg = mockInsertAuditLog.mock.calls[0][0];
    expect(typeof callArg.created_at).toBe('number');
  });

  it('recordAuditLog does not throw when insertAuditLogResult rejects', async () => {
    mockInsertAuditLog.mockRejectedValue(new Error('offscreen unreachable'));

    await expect(recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' })).resolves.toBeUndefined();
  });

  it('recordAuditLog logs error when insertAuditLogResult fails', async () => {
    mockInsertAuditLog.mockResolvedValue({ success: false, error: { message: 'insert failed' } });
    const { logError } = await import('../logger.js');

    await recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' });

    expect(logError).toHaveBeenCalledWith(
      'Failed to record audit log',
      expect.objectContaining({ provider: 'gemini' })
    );
  });

  it('getAuditLogs delegates to SqliteClient.queryAuditLogResult', async () => {
    mockQueryAuditLogResult.mockResolvedValue({
      success: true,
      data: {
        rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1000 }],
        total: 1,
      },
    });

    const result = await getAuditLogs({ limit: 10, offset: 0 });

    expect(mockQueryAuditLogResult).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
