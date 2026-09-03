import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutate = vi.fn().mockResolvedValue({ success: true, data: { id: 1 } });
const mockQuery = vi.fn().mockResolvedValue({ success: true, data: { rows: [], total: 0 } });

vi.mock('../../background/sqlite/offscreenGateway.js', () => {
  class MockSqliteClient {
    async mutate(op: Record<string, unknown>) {
      return mockMutate(op);
    }

    async query(op: Record<string, unknown>) {
      return mockQuery(op);
    }
  }

  return {
    SqliteClient: MockSqliteClient,
    getSharedSqliteClient: () => new MockSqliteClient(),
  };
});

vi.mock('../logger.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...(actual as object),
    logError: vi.fn(),
  };
});

// Import after mocking
import { recordAuditLog, getAuditLogs } from '../auditLog.js';

describe('auditLog', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockQuery.mockClear();
    mockMutate.mockResolvedValue({ success: true, data: { id: 1 } });
    mockQuery.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
  });

  it('recordAuditLog calls SqliteClient.mutate insertAuditLog with provider, url, and a timestamp', async () => {
    await recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' });

    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'insertAuditLog', record: expect.objectContaining({ provider: 'gemini', url: 'https://example.com/page' }) })
    );
    const callArg = (mockMutate.mock.calls[0][0] as any).record;
    expect(typeof callArg.created_at).toBe('number');
  });

  it('recordAuditLog does not throw when mutate rejects', async () => {
    mockMutate.mockRejectedValue(new Error('offscreen unreachable'));

    await expect(recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' })).resolves.toBeUndefined();
  });

  it('recordAuditLog logs error when mutate fails', async () => {
    mockMutate.mockResolvedValue({ success: false, error: { message: 'insert failed' } });
    const { logError } = await import('../logger.js');

    await recordAuditLog({ provider: 'gemini', url: 'https://example.com/page' });

    expect(logError).toHaveBeenCalledWith(
      'Failed to record audit log',
      expect.objectContaining({ provider: 'gemini' })
    );
  });

  it('getAuditLogs delegates to SqliteClient.query auditLog', async () => {
    mockQuery.mockResolvedValue({
      success: true,
      data: {
        rows: [{ id: 1, provider: 'gemini', url: 'https://example.com', created_at: 1000 }],
        total: 1,
      },
    });

    const result = await getAuditLogs({ limit: 10, offset: 0 });

    expect(mockQuery).toHaveBeenCalledWith({ kind: 'auditLog', limit: 10, offset: 0 });
    expect(result.rows).toHaveLength(1);
    expect(result.total).toBe(1);
  });

  it('getAuditLogs returns empty when query fails', async () => {
    mockQuery.mockResolvedValue({ success: false, error: { message: 'db error' } } as any);

    const result = await getAuditLogs({ limit: 10, offset: 0 });

    expect(result).toEqual({ rows: [], total: 0 });
  });

  it('getAuditLogs uses default limit and offset', async () => {
    mockQuery.mockResolvedValue({ success: true, data: { rows: [], total: 0 } });
    const result = await getAuditLogs();
    expect(mockQuery).toHaveBeenCalledWith({ kind: 'auditLog', limit: 100, offset: 0 });
    expect(result).toEqual({ rows: [], total: 0 });
  });
});
