import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleDashboardSqlite } from '../handlers/dashboardSqliteHandlers.js';
import { SqliteClient } from '../sqliteClient.js';

describe('dashboardSqliteHandlers — confirmation token (H2)', () => {
  let sqliteClient: SqliteClient;
  const VALID_TOKEN = 'test-valid-token-12345';
  const INVALID_TOKEN = 'wrong-token';

  beforeEach(() => {
    sqliteClient = new SqliteClient();
    (sqliteClient as unknown as { clearAll: ReturnType<typeof vi.fn> }).clearAll = vi.fn().mockResolvedValue(true);
  });

  it('rejects clear_all without confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'clear_all' },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
    expect((sqliteClient.clearAll as unknown as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('rejects clear_all with invalid confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'clear_all', confirmToken: INVALID_TOKEN },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
  });

  it('accepts clear_all with valid confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'clear_all', confirmToken: VALID_TOKEN },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true });
    expect((sqliteClient.clearAll as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('rejects migrate without confirmToken', async () => {
    const result = await handleDashboardSqlite(
      { subtype: 'migrate' },
      sqliteClient,
      async () => ({ success: true, count: 0, read: 0, inserted: 0 }),
      VALID_TOKEN
    );
    expect(result).toEqual({ success: false, error: expect.stringContaining('token') });
  });

  it('allows query without confirmToken (read-only)', async () => {
    (sqliteClient as unknown as { query: ReturnType<typeof vi.fn> }).query = vi.fn().mockResolvedValue({ rows: [], total: 0 });
    const result = await handleDashboardSqlite(
      { subtype: 'query' },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toMatchObject({ success: true });
  });
});
