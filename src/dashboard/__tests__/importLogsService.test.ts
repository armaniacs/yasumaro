// @vitest-environment jsdom
/**
 * importLogsService.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../dashboardSqliteService.js', () => ({
  importLogs: vi.fn(),
}));

// Deterministic crypto so fixtures can be signed in-test. computeHMAC is a
// pure function of (secret, payload); constantTimeCompare is a plain equals.
vi.mock('../../utils/storage/encryptionSession.js', () => ({
  getOrCreateHmacSecret: vi.fn(async () => 'test-secret'),
}));
vi.mock('../../utils/crypto/index.js', () => ({
  computeHMAC: vi.fn(async (secret: string, payload: string) => `hmac(${secret}):${payload.length}:${payload.slice(0, 8)}`),
  constantTimeCompare: vi.fn(async (a: string, b: string) => a === b),
}));

import { importLogs } from '../dashboardSqliteService.js';
import { computeHMAC } from '../../utils/crypto/index.js';

/** Build a signed log-export JSON string the way exportJson would. */
async function signedExport(rows: unknown[], overrides: Record<string, unknown> = {}): Promise<string> {
  const body = { version: 2, table: 'browsing_logs', rows, ...overrides };
  const signature = await computeHMAC('test-secret', JSON.stringify(body, null, 2));
  return JSON.stringify({ ...body, signature });
}

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

  it('rejects an unsigned file', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const result = await importFromJson(JSON.stringify({ rows: [{ url: 'https://a.com', created_at: 1 }] }));
    expect(result).toEqual({
      error: 'This log file is unsigned and cannot be imported. Re-export it from this extension.',
    });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('rejects a tampered file (signature mismatch)', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const json = await signedExport([{ url: 'https://a.com', created_at: 1 }]);
    const tampered = JSON.parse(json);
    tampered.rows.push({ url: 'https://evil.com', created_at: 2 });
    const result = await importFromJson(JSON.stringify(tampered));
    expect(result).toEqual({
      error: 'Log file signature verification failed. The file may be corrupted or was exported from a different browser profile.',
    });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('returns error when rows array is empty', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const result = await importFromJson(await signedExport([]));
    expect(result).toEqual({ error: 'No records found in file' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('returns error when rows field is missing', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const body = { version: 2, table: 'browsing_logs' };
    const signature = await computeHMAC('test-secret', JSON.stringify(body, null, 2));
    const result = await importFromJson(JSON.stringify({ ...body, signature }));
    expect(result).toEqual({ error: 'No records found in file' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('returns error when all rows are invalid', async () => {
    const { importFromJson } = await import('../importLogsService.js');
    const json = await signedExport([{ title: 'no url' }, { url: '', created_at: 100 }]);
    const result = await importFromJson(json);
    expect(result).toEqual({ error: 'No valid records found (url and created_at required)' });
    expect(importLogs).not.toHaveBeenCalled();
  });

  it('imports valid rows and filters out invalid ones', async () => {
    vi.mocked(importLogs).mockResolvedValue({ data: { inserted: 2, skipped: 0, total: 2 } });
    const { importFromJson } = await import('../importLogsService.js');
    const json = await signedExport([
      { url: 'https://example.com', created_at: 1000 },
      { url: 'https://test.com', created_at: 2000, title: 'Test' },
      { title: 'no url' },
    ]);
    const result = await importFromJson(json);
    expect(result).toEqual({ inserted: 2, skipped: 0, total: 2 });
    expect(importLogs).toHaveBeenCalledWith([
      { url: 'https://example.com', created_at: 1000 },
      { url: 'https://test.com', created_at: 2000, title: 'Test' },
    ]);
  });

  it('calls onProgress callback with current and total', async () => {
    vi.mocked(importLogs).mockResolvedValue({ data: { inserted: 10, skipped: 0, total: 10 } });
    const { importFromJson } = await import('../importLogsService.js');
    const onProgress = vi.fn();
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example${i}.com`,
      created_at: 1000 + i,
    }));
    const result = await importFromJson(await signedExport(rows), onProgress);
    expect(result).toEqual({ inserted: 20, skipped: 0, total: 250 });
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 200, 250);
    expect(onProgress).toHaveBeenNthCalledWith(2, 250, 250);
  });

  it('handle batch where importLogs fails and counts skipped', async () => {
    vi.mocked(importLogs)
      .mockResolvedValueOnce({ data: { inserted: 2, skipped: 0, total: 2 } })
      .mockResolvedValueOnce({ error: 'Batch too large' });
    const { importFromJson } = await import('../importLogsService.js');
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example${i}.com`,
      created_at: 1000 + i,
    }));
    const result = await importFromJson(await signedExport(rows));
    expect(result).toEqual({ inserted: 2, skipped: 50, total: 250 });
  });

  it('surfaces the reason when every batch fails', async () => {
    vi.mocked(importLogs).mockResolvedValue({ error: 'Database is locked' });
    const { importFromJson } = await import('../importLogsService.js');
    const json = await signedExport([{ url: 'https://example.com', created_at: 1000 }]);
    const result = await importFromJson(json);
    expect(result).toEqual({ error: 'Database is locked' });
  });

  it('joins distinct reasons across multiple failed batches', async () => {
    vi.mocked(importLogs)
      .mockResolvedValueOnce({ error: 'Database is locked' })
      .mockResolvedValueOnce({ error: 'Batch too large' });
    const { importFromJson } = await import('../importLogsService.js');
    const rows = Array.from({ length: 250 }, (_, i) => ({
      url: `https://example${i}.com`,
      created_at: 1000 + i,
    }));
    const result = await importFromJson(await signedExport(rows));
    expect(result).toEqual({ error: 'Database is locked; Batch too large' });
  });
});
