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

  it('routes opfs_spike to sqliteClient.runOpfsSpike and returns the report', async () => {
    const report = { strategy: 'opfs-async-main', steps: [], passed: true, durationMs: 5 };
    (sqliteClient as unknown as { runOpfsSpike: ReturnType<typeof vi.fn> }).runOpfsSpike =
      vi.fn().mockResolvedValue(report);

    const result = await handleDashboardSqlite({ subtype: 'opfs_spike' }, sqliteClient);

    expect((sqliteClient as unknown as { runOpfsSpike: ReturnType<typeof vi.fn> }).runOpfsSpike).toHaveBeenCalled();
    expect(result).toEqual({ success: true, report });
  });

  it('returns an error when opfs_spike yields no report', async () => {
    (sqliteClient as unknown as { runOpfsSpike: ReturnType<typeof vi.fn> }).runOpfsSpike =
      vi.fn().mockResolvedValue(null);

    const result = await handleDashboardSqlite({ subtype: 'opfs_spike' }, sqliteClient);

    expect(result).toEqual({ success: false, error: expect.stringContaining('spike') });
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

  it('wraps search results with success:true (regression: dashboard search showed load error)', async () => {
    // sqliteClient.search resolves to { rows, total } with NO success field.
    // The handler must add success:true so the dashboard service does not treat
    // a valid result as a failure ("データの読み込みに失敗しました").
    const rows = [{ id: 1, url: 'https://a.com', title: 'kddi', rank: -1 }];
    (sqliteClient as unknown as { search: ReturnType<typeof vi.fn> }).search =
      vi.fn().mockResolvedValue({ rows, total: 1 });
    const result = await handleDashboardSqlite(
      { subtype: 'search', query: 'kddi' },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toEqual({ success: true, rows, total: 1 });
  });

  it('returns success:false when search yields null', async () => {
    (sqliteClient as unknown as { search: ReturnType<typeof vi.fn> }).search =
      vi.fn().mockResolvedValue(null);
    const result = await handleDashboardSqlite(
      { subtype: 'search', query: 'kddi' },
      sqliteClient,
      undefined,
      VALID_TOKEN
    );
    expect(result).toMatchObject({ success: false });
  });
});
