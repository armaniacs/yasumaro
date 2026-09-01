// @vitest-environment jsdom
/**
 * logExportSignature.test.ts
 * End-to-end: exportJson signs, importFromJson verifies (VULN-035).
 * Uses the real HMAC primitive and the storage-mock-backed secret, so a
 * regression in the signed byte range is caught here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQueryLogs = vi.fn();
const mockImportLogs = vi.fn();

vi.mock('../dashboardSqliteService.js', () => ({
  queryLogs: (...args: unknown[]) => mockQueryLogs(...args),
  importLogs: (...args: unknown[]) => mockImportLogs(...args),
}));

import { exportJson } from '../exportLogsService.js';
import { importFromJson } from '../importLogsService.js';

const ROWS = [
  { id: 1, url: 'https://example.com/a', title: 'A', summary: 's1', tags: '["x"]', created_at: 1_700_000_000_000, domain: 'example.com', is_starred: 0 },
  { id: 2, url: 'https://example.com/b', title: 'B', summary: 's2', tags: '[]', created_at: 1_700_000_100_000, domain: 'example.com', is_starred: 1 },
];

describe('log export/import signature round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryLogs.mockResolvedValue({ data: { rows: ROWS, total: ROWS.length } });
    mockImportLogs.mockResolvedValue({ data: { inserted: ROWS.length, skipped: 0, total: ROWS.length } });
  });

  it('a freshly exported file imports successfully', async () => {
    const json = await (await exportJson()).text();
    const result = await importFromJson(json);
    expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
  });

  it('flipping one byte of the body fails verification', async () => {
    const parsed = JSON.parse(await (await exportJson()).text());
    parsed.rows[0].title = 'A-tampered';
    const result = await importFromJson(JSON.stringify(parsed));
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toMatch(/signature verification failed/i);
    expect(mockImportLogs).not.toHaveBeenCalled();
  });

  it('stripping the signature is rejected as unsigned', async () => {
    const parsed = JSON.parse(await (await exportJson()).text());
    delete parsed.signature;
    const result = await importFromJson(JSON.stringify(parsed));
    expect((result as { error: string }).error).toMatch(/unsigned/i);
    expect(mockImportLogs).not.toHaveBeenCalled();
  });
});
