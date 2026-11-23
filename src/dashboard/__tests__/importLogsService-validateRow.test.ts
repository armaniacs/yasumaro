// @vitest-environment wasm-quickjs-dom
/**
 * importLogsService-validateRow.test.ts
 * All-field boundary tests for the log-import row validator (VULN-035).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// PBI 2026-09-23-02: importLogsService calls the generic seam.
const mockSqliteCall = vi.fn();
vi.mock('../dashboardSqliteService.js', () => ({
  sqliteClient: { call: (...args: unknown[]) => mockSqliteCall(...args) },
}));

// Deterministic signer so fixtures can be signed in-test.
const fakeSign = async (payload: string) =>
  `hmac(test-secret):${payload.length}:${payload.slice(0, 8)}`;
vi.mock('../../utils/storage/encryptionSession.js', () => ({
  exportHmacSigner: {
    sign: vi.fn(fakeSign),
    verify: vi.fn(async (payload: string, sig: string) => sig === (await fakeSign(payload))),
  },
}));

const NOW = 1_700_000_000_000;

async function importRows(rows: unknown[]) {
  const { importFromJson } = await import('../importLogsService.js');
  const body = { version: 2, table: 'browsing_logs', rows };
  const signature = await fakeSign(JSON.stringify(body, null, 2));
  return importFromJson(JSON.stringify({ ...body, signature }));
}

describe('validateRow (via importFromJson)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSqliteCall.mockResolvedValue({ data: { inserted: 1, skipped: 0, total: 1 } });
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

describe('validateImportRowWithOptions (strict canonical / lenient background parity)', () => {
  it('exposes a shared validator with a strict option (canonical)', async () => {
    const mod = await import('../importLogsService.js');
    expect(typeof (mod as Record<string, unknown>).validateImportRowWithOptions).toBe('function');
  });

  it('strict wrapper delegates to the canonical strict call', async () => {
    const { validateImportRowReason, validateImportRowWithOptions } = await import(
      '../importLogsService.js'
    );
    const cases: unknown[] = [
      { url: 'https://a.test', created_at: NOW },
      { url: 'https://a.test', created_at: Date.now() + 5 * 24 * 3600 * 1000 },
      { url: 'https://a.test/' + 'x'.repeat(3000), created_at: NOW },
      { url: 'https://a.test', created_at: NOW, title: 'x'.repeat(3000) },
      { url: 'https://a.test', created_at: 0 },
      { url: 'https://a.test', created_at: NOW, visit_duration: null },
    ];
    for (const row of cases) {
      expect(validateImportRowReason(row as never)).toBe(
        validateImportRowWithOptions(row, { strict: true })
      );
    }
  });

  it('strict rejects future/over-long rows while lenient accepts them (background parity)', async () => {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    const { validateImportRow } = await import('../../messaging/validators.js');
    const future = Date.now() + 5 * 24 * 3600 * 1000;
    const divergent: unknown[] = [
      { url: 'https://a.test', created_at: future },
      { url: 'https://a.test/' + 'x'.repeat(3000), created_at: NOW },
      { url: 'https://a.test', created_at: NOW, title: 'x'.repeat(3000) },
      { url: 'https://a.test', created_at: NOW, summary: 'y'.repeat(100_001) },
      { url: 'https://a.test', created_at: NOW, visit_duration: 10 * 24 * 3600 * 1000 },
    ];
    for (const row of divergent) {
      expect(validateImportRowWithOptions(row, { strict: true })).not.toBeNull();
      expect(validateImportRowWithOptions(row, { strict: false })).toBeNull();
      expect(validateImportRow(row)).toBeNull();
    }
  });

  it('lenient matches validateImportRow on null-tolerant optional fields', async () => {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    const { validateImportRow } = await import('../../messaging/validators.js');
    const rows: unknown[] = [
      { url: 'https://a.test', created_at: NOW, visit_duration: null },
      { url: 'https://a.test', created_at: NOW, scroll_ratio: null },
      { url: 'https://a.test', created_at: NOW, is_starred: null },
      { url: 'https://a.test', created_at: NOW, title: null },
    ];
    for (const row of rows) {
      expect(validateImportRowWithOptions(row, { strict: false })).toBe(
        validateImportRow(row)
      );
    }
    // Strict keeps rejecting null numerics/flags (no cap relaxation).
    expect(
      validateImportRowWithOptions(
        { url: 'https://a.test', created_at: NOW, visit_duration: null },
        { strict: true }
      )
    ).not.toBeNull();
  });

  it('strict stays byte-identical on the shared rejection messages', async () => {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    expect(
      validateImportRowWithOptions({ url: '', created_at: NOW }, { strict: true })
    ).toBe('url must be a non-empty string');
    expect(
      validateImportRowWithOptions({ url: 'https://a.test' }, { strict: true })
    ).toBe('created_at must be a finite number');
    expect(
      validateImportRowWithOptions(
        { url: 'https://a.test', created_at: NOW, scroll_ratio: 5 },
        { strict: true }
      )
    ).toBe('scroll_ratio must be between 0 and 1');
  });
});
