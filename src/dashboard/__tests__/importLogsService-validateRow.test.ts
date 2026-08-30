// @vitest-environment jsdom
/**
 * importLogsService-validateRow.test.ts
 * All-field boundary tests for the log-import row validator (VULN-035).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dashboardSqliteService.js', () => ({
  importLogs: vi.fn(),
}));

import { importLogs } from '../dashboardSqliteService.js';

const NOW = 1_700_000_000_000;

async function importRows(rows: unknown[]) {
  const { importFromJson } = await import('../importLogsService.js');
  return importFromJson(JSON.stringify({ rows }));
}

describe('validateRow (via importFromJson)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(importLogs).mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
  });

  it('accepts a minimal old-format row (url + created_at only)', async () => {
    const res = await importRows([{ url: 'https://a.test', created_at: NOW }]);
    expect(res).toMatchObject({ total: 1 });
  });

  it('rejects a non-numeric / non-positive created_at', async () => {
    const res = await importRows([
      { url: 'https://a.test', created_at: 'nope' },
      { url: 'https://b.test', created_at: 0 },
      { url: 'https://c.test', created_at: Number.NaN },
    ]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('rejects a future created_at beyond clock skew', async () => {
    const res = await importRows([{ url: 'https://a.test', created_at: Date.now() + 5 * 24 * 3600 * 1000 }]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('rejects an over-long url', async () => {
    const res = await importRows([{ url: 'https://a.test/' + 'x'.repeat(3000), created_at: NOW }]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('rejects scroll_ratio out of 0..1', async () => {
    const res = await importRows([{ url: 'https://a.test', created_at: NOW, scroll_ratio: 5 }]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('rejects a non-flag is_starred', async () => {
    const res = await importRows([{ url: 'https://a.test', created_at: NOW, is_starred: 2 }]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('rejects a negative visit_duration', async () => {
    const res = await importRows([{ url: 'https://a.test', created_at: NOW, visit_duration: -1 }]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('rejects a non-string title', async () => {
    const res = await importRows([{ url: 'https://a.test', created_at: NOW, title: 123 }]);
    expect(res).toMatchObject({ error: expect.any(String) });
  });

  it('accepts a fully-populated valid row', async () => {
    const res = await importRows([{
      url: 'https://a.test',
      title: 'T',
      summary: 'S',
      tags: '["x"]',
      created_at: NOW,
      domain: 'a.test',
      visit_duration: 1000,
      scroll_ratio: 0.5,
      is_starred: 1,
      is_deleted: 0,
    }]);
    expect(res).toMatchObject({ total: 1 });
  });

  it('rejects an import exceeding the row cap', async () => {
    const rows = Array.from({ length: 100_001 }, () => ({ url: 'https://a.test', created_at: NOW }));
    const res = await importRows(rows);
    expect(res).toMatchObject({ error: expect.stringContaining('row limit') });
  });
});
