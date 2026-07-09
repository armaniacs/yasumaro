// @vitest-environment jsdom
/**
 * importLogsService.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dashboardSqliteService.js', () => ({
  importLogs: vi.fn(),
}));

import { importLogs } from '../dashboardSqliteService.js';

describe('importFromJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error for invalid JSON', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const result = await importFromJson('not json');
    expect(result).toEqual({ error: 'Invalid JSON format' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('returns error when rows array is empty', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const result = await importFromJson(JSON.stringify({ rows: [] }));
    expect(result).toEqual({ error: 'No records found in file' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('returns error when rows field is missing', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const result = await importFromJson(JSON.stringify({}));
    expect(result).toEqual({ error: 'No records found in file' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('returns error when all rows are invalid', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const json = JSON.stringify({ rows: [{ title: 'no url' }, { url: '', created_at: 100 }] });
    const result = await importFromJson(json);
    expect(result).toEqual({ error: 'No valid records found (url and created_at required)' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('imports valid rows and filters out invalid ones', async () => {
    vi.mocked(importLogs).mockResolvedValue({ inserted: 2, skipped: 0, total: 2 });
    const { importFromJson } = await import('../importLogsService.js');
    const json = JSON.stringify({
      rows: [
        { url: 'https://example.com', created_at: 1000 },
        { url: 'https://test.com', created_at: 2000, title: 'Test' },
        { title: 'no url' },
      ],
    });
    const result = await importFromJson(json);
    expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
    expect(importLogs).toHaveBeenCalledWith([
      { url: 'https://example.com', created_at: 1000 },
      { url: 'https://test.com', created_at: 2000, title: 'Test' },
    ]);
  });

  it('calls onProgress callback with current and total', async () => {
    vi.mocked(importLogs).mockResolvedValue({ inserted: 10, skipped: 0, total: 10 });
    const { importFromJson } = await import('../importLogsService.js');
    const onProgress = vi.fn();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example${i}.com`,
      created_at: 1000 + i,
    }));
    const json = JSON.stringify({ rows });
    const result = await importFromJson(json, onProgress);
    expect(result).toEqual({ inserted: 20, skipped: 0, total: 250 });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 200, 250);
    expect(onProgress).toHaveBeenNthCalledWith(2, 250, 250);
  });

  it('handle batch where importLogs returns null and counts skipped', async () => {
    vi.mocked(importLogs)
      .mockResolvedValueOnce({ inserted: 2, skipped: 0, total: 2 })
      .mockResolvedValueOnce(null);
    const { importFromJson } = await import('../importLogsService.js');
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example${i}.com`,
      created_at: 1000 + i,
    }));
    const json = JSON.stringify({ rows });
    const result = await importFromJson(json);
    expect(result).toEqual({ inserted: 2, skipped: 50, total: 250 });
  });
});
