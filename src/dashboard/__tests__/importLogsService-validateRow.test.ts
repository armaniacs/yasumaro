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

describe('validateImportRowWithOptions (strict dashboard gate / lenient = layer-0 contract)', () => {
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

  it('strict rejects future/over-long rows while the layer-0 lenient path accepts them', async () => {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    const { validateImportRow } = await import('../../utils/logImportContract.js');
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
      expect(validateImportRowWithOptions(row, { strict: false })).toBe(validateImportRow(row));
      expect(validateImportRow(row)).toBeNull();
    }
  });

  it('lenient path is the single layer-0 implementation (null-tolerant optional fields)', async () => {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    const { validateImportRow } = await import('../../utils/logImportContract.js');
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

describe('strict gate golden (PBI 2026-11-26-09)', () => {
  const NOW = 1_700_000_000_000;
  const row = (patch: Record<string, unknown> = {}): Record<string, unknown> => ({
    url: 'https://a.test',
    created_at: NOW,
    ...patch,
  });

  async function strict(patch: Record<string, unknown> = {}, options?: { now?: number }) {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    return validateImportRowWithOptions(row(patch), { strict: true, ...options });
  }

  it('pins the dashboard-only length caps byte-identically', async () => {
    expect(await strict({ url: 'https://a.test/' + 'x'.repeat(3000) })).toBe(
      'url must be at most 2048 characters'
    );
    expect(await strict({ title: 'x'.repeat(2049) })).toBe('title must be at most 2048 characters');
    expect(await strict({ summary: 'y'.repeat(100_001) })).toBe(
      'summary must be at most 100000 characters'
    );
    expect(await strict({ tags: 't'.repeat(8193) })).toBe('tags must be at most 8192 characters');
    expect(await strict({ domain: 'd'.repeat(257) })).toBe('domain must be at most 256 characters');
  });

  it('pins the created_at floor, future bound, and clock-skew boundary', async () => {
    expect(await strict({ created_at: 0 })).toBe('created_at must be a finite number');
    expect(await strict({ created_at: -5 })).toBe('created_at must be a finite number');
    expect(await strict({ created_at: NOW + 5 * 24 * 3600 * 1000 }, { now: NOW })).toBe(
      'created_at must not be in the future'
    );
    expect(await strict({ created_at: NOW + 25 * 3600 * 1000 }, { now: NOW })).toBe(
      'created_at must not be in the future'
    );
    expect(await strict({ created_at: NOW + 24 * 3600 * 1000 }, { now: NOW })).toBeNull();
  });

  it('pins strict non-null numerics/flags and the metric ceilings', async () => {
    expect(await strict({ visit_duration: null })).toBe('visit_duration must be a finite number');
    expect(await strict({ scroll_ratio: null })).toBe('scroll_ratio must be a finite number');
    expect(await strict({ is_starred: null })).toBe('is_starred must be 0 or 1');
    expect(await strict({ is_deleted: null })).toBe('is_deleted must be 0 or 1');
    expect(await strict({ visit_duration: 10 * 24 * 3600 * 1000 })).toBe(
      'visit_duration must be >= 0'
    );
    expect(await strict({ visit_duration: 24 * 3600 * 1000 })).toBeNull();
    expect(await strict({ scroll_ratio: 1 })).toBeNull();
  });

  it('pins the strict first-fail order (url cap before created_at floor before text caps)', async () => {
    expect(await strict({ url: 'https://a.test/' + 'x'.repeat(3000), created_at: 0 })).toBe(
      'url must be at most 2048 characters'
    );
    expect(await strict({ created_at: 0, title: 123 })).toBe(
      'created_at must be a finite number'
    );
    expect(await strict({ title: 'x'.repeat(2049), summary: 'y'.repeat(100_001) })).toBe(
      'title must be at most 2048 characters'
    );
  });

  it('defaults to strict when no options are given', async () => {
    const { validateImportRowWithOptions } = await import('../importLogsService.js');
    expect(validateImportRowWithOptions(row({ title: 'x'.repeat(2049) }))).toBe(
      'title must be at most 2048 characters'
    );
  });
});
